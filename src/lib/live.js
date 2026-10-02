import { register } from '@register';
import { isStated, isAddress, linkOf } from '../facts.js';
import { setNumber, setUnavailable, fmtInt, fmtGwei, fmtUsd } from './countup.js';

const TIMEOUT = 8000;
const RPC_EVERY = 6000;
const SLOW_EVERY = 60000;
const RETRY_BASE = 5000;
const PAIR_ID = /^0x[0-9a-fA-F]{40,64}$/; // pool ids may be 40 or 64 hex chars; never reject 0x wholesale

async function getJson(url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const hexNum = (h) => Number(BigInt(h));

async function readRpc() {
  const body = JSON.stringify([
    { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
    { jsonrpc: '2.0', id: 2, method: 'eth_gasPrice', params: [] },
  ]);
  const out = await getJson(register.rpc.value, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const by = Object.fromEntries(out.map((r) => [r.id, r.result]));
  const block = hexNum(by[1]);
  const gwei = hexNum(by[2]) / 1e9;
  if (!Number.isFinite(block) || !Number.isFinite(gwei)) throw new Error('bad rpc');
  return { block, gwei };
}

async function readTvl() {
  const rows = await getJson('https://api.llama.fi/v2/historicalChainTvl/' + encodeURIComponent(register.llamaChain.value));
  const last = Array.isArray(rows) ? rows[rows.length - 1] : null;
  if (!last || !Number.isFinite(last.tvl)) throw new Error('bad tvl');
  return last.tvl;
}

async function readPairs() {
  const chain = register.dexChain.value;
  let list;
  if (isStated(register.ca) && isAddress(register.ca.value)) {
    list = await getJson(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chain)}/${register.ca.value}`);
  } else {
    const j = await getJson('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(register.chainName.value));
    list = j && j.pairs;
  }
  if (!Array.isArray(list)) throw new Error('bad pairs');
  return list
    .filter((p) => p && p.chainId === chain && p.liquidity && Number.isFinite(p.liquidity.usd))
    .sort((a, b) => b.liquidity.usd - a.liquidity.usd)
    .slice(0, 5);
}

function price(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return '-';
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(Math.min(12, Math.max(2, 2 - Math.floor(Math.log10(n)))));
}
const clip = (s, n = 18) => String(s == null ? '' : s).slice(0, n);

function cell(text, label) {
  const c = document.createElement('span');
  c.className = 'pair-cell';
  const small = document.createElement('small');
  small.textContent = label;
  c.append(small, document.createTextNode(text));
  return c;
}

function renderPairs(list) {
  const ul = document.getElementById('pairs-list');
  if (!ul) return;
  ul.textContent = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'pairs-empty';
    li.textContent = 'No pairs were returned for this chain just now.';
    ul.appendChild(li);
    return;
  }
  const base = linkOf(register.dexUrl);
  list.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'pair-row';
    const id = String(p.pairAddress || '');
    const linkable = base && PAIR_ID.test(id);
    const row = document.createElement(linkable ? 'a' : 'div');
    row.className = 'pair-link';
    if (linkable) {
      row.href = base.replace(/\/$/, '') + '/' + id;
      row.target = '_blank';
      row.rel = 'noopener noreferrer';
    }
    const name = document.createElement('span');
    name.className = 'pair-name';
    name.textContent = `${clip(p.baseToken && p.baseToken.symbol)} / ${clip(p.quoteToken && p.quoteToken.symbol)}`;
    const dex = document.createElement('small');
    dex.textContent = [clip(p.dexId, 14), ...(Array.isArray(p.labels) ? p.labels.slice(0, 1).map((l) => clip(l, 6)) : [])].join(' ');
    name.appendChild(dex);
    const vol = p.volume && Number.isFinite(p.volume.h24) ? fmtUsd(p.volume.h24) : '-';
    row.append(name, cell(price(p.priceUsd), 'price'), cell(vol, '24h vol'), cell(fmtUsd(p.liquidity.usd), 'liq'));
    row.children[2].classList.add('hide-sm');
    li.appendChild(row);
    ul.appendChild(li);
  });
}

const STATUS_TEXT = {
  loading: 'Reading the chain',
  live: 'Synced with ' + register.chainName.value,
  degraded: 'Some readings are late',
  offline: 'Readings offline',
};

export function initLive() {
  const results = { rpc: 'idle', tvl: 'idle', pairs: 'idle' };
  const targets = (key) => [...document.querySelectorAll(`[data-live="${key}"]`)];
  document.querySelectorAll('[data-live]').forEach((el) => el.setAttribute('aria-busy', 'true'));
  const pill = document.getElementById('status-pill');
  const pillText = document.getElementById('status-text');
  let stopped = false;

  const paintStatus = () => {
    const vals = Object.values(results);
    let s = 'loading';
    if (vals.every((v) => v !== 'idle')) {
      if (vals.every((v) => v === 'fail')) s = 'offline';
      else if (results.rpc === 'ok' && results.tvl === 'ok' && results.pairs === 'ok') s = 'live';
      else s = 'degraded';
    } else if (results.rpc === 'ok') s = 'live';
    if (pill) pill.dataset.status = s;
    if (pillText) pillText.textContent = STATUS_TEXT[s];
  };

  const run = (name, fn, apply, fail) => async () => {
    if (stopped || document.hidden) return true;
    let good = true;
    try {
      apply(await fn());
      results[name] = 'ok';
    } catch (err) {
      console.warn('accrue: reading ' + name + ' failed:', err && err.message);
      results[name] = 'fail';
      good = false;
      fail();
    }
    paintStatus();
    return good;
  };

  const rpc = run(
    'rpc',
    readRpc,
    ({ block, gwei }) => {
      targets('block').concat(targets('block-big')).forEach((el) => setNumber(el, block, fmtInt));
      targets('gas').concat(targets('gas-big')).forEach((el) => setNumber(el, gwei, fmtGwei));
    },
    () => targets('block').concat(targets('block-big'), targets('gas'), targets('gas-big')).forEach(setUnavailable)
  );
  const tvl = run(
    'tvl',
    readTvl,
    (v) => targets('tvl').concat(targets('tvl-big')).forEach((el) => setNumber(el, v, fmtUsd)),
    () => targets('tvl').concat(targets('tvl-big')).forEach(setUnavailable)
  );
  const pairs = run('pairs', readPairs, renderPairs, () => {
    const ul = document.getElementById('pairs-list');
    if (!ul || ul.querySelector('.pair-link')) return;
    ul.textContent = '';
    const li = document.createElement('li');
    li.className = 'pairs-empty';
    li.textContent = 'Pairs are unavailable right now.';
    ul.appendChild(li);
  });

  const timers = [];
  // a failed read is retried sooner than the normal cadence, backing off up to the cadence itself
  const every = (fn, ms) => {
    let misses = 0;
    const tick = async () => {
      const good = await fn();
      misses = good ? 0 : misses + 1;
      const wait = good ? ms : Math.min(ms, RETRY_BASE * misses);
      if (!stopped) timers.push(setTimeout(tick, wait));
    };
    tick();
  };
  every(rpc, RPC_EVERY);
  every(tvl, SLOW_EVERY);
  every(pairs, SLOW_EVERY);
  paintStatus();

  // a tab that loaded in the background catches up the moment it becomes visible
  const onVisible = () => {
    if (document.hidden) return;
    rpc();
    tvl();
    pairs();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
