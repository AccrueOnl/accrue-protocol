import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';
import { register as fixtureRegister } from '../fixtures/registry.stated.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

export function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = normalize(join(dir, p));
        if (!file.startsWith(normalize(dir))) throw new Error('out');
        await stat(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(await readFile(file));
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() }));
  });
}

export async function launch() {
  const candidates = [
    { channel: 'chrome' },
    { channel: 'msedge' },
    { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
    { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' },
  ];
  let last;
  for (const c of candidates) {
    if (c.executablePath && !existsSync(c.executablePath)) continue;
    try {
      return await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--disable-background-networking', '--no-first-run'], ...c });
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error('no Chromium-family browser found');
}

/* ---------- synthetic fixtures (no network, no real data) ---------- */
export const FX = {
  block: 4242424,
  blockNext: 4242430,
  gweiWei: 0x13b9510, // 20,624,656 wei = 0.0206 gwei
  tvl: 1234567890,
  tvlNext: 1300000000,
};
FX.address = fixtureRegister.ca.value;
FX.pairId64 = '0x' + '1f'.repeat(32);
FX.x = 'https://x.com/fixture_handle';
FX.github = 'https://github.com/fixture-org';

const hex = (n) => '0x' + n.toString(16);

export function pairsPayload() {
  const mk = (s, q, liq, vol, id) => ({
    chainId: 'robinhood',
    dexId: 'fixturedex',
    labels: ['v4'],
    pairAddress: id,
    baseToken: { symbol: s },
    quoteToken: { symbol: q },
    priceUsd: '0.00163',
    volume: { h24: vol },
    liquidity: { usd: liq },
  });
  return {
    pairs: [
      mk('AAA', 'WETH', 50000, 12000, FX.pairId64),
      mk('BBB', 'USDX', 900000, 450000, '0x' + '2e'.repeat(20)),
      { ...mk('OFF', 'ETH', 5, 1, '0x' + '3d'.repeat(20)), chainId: 'othernet' },
    ],
  };
}

/**
 * Route all live endpoints to synthetic fixtures.
 * mode: 'ok' | 'fail' | 'slow'. Returns a handle to bump values between polls.
 */
export async function routeLive(page, mode = 'ok') {
  const st = { block: FX.block, tvl: FX.tvl, hits: { rpc: 0, llama: 0, dex: 0 }, release: null };
  const gate = mode === 'slow' ? new Promise((r) => (st.release = r)) : null;
  const fulfillJson = (route, body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
  const handle = async (route, kind, body) => {
    st.hits[kind]++;
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    if (gate) await gate;
    if (mode === 'fail') return fulfillJson(route, { error: 'fixture failure' }, 500);
    return fulfillJson(route, body());
  };
  await page.route('https://rpc.mainnet.chain.robinhood.com/**', (r) =>
    handle(r, 'rpc', () => [
      { jsonrpc: '2.0', id: 1, result: hex(st.block) },
      { jsonrpc: '2.0', id: 2, result: hex(FX.gweiWei) },
    ])
  );
  await page.route('https://api.llama.fi/**', (r) => handle(r, 'llama', () => [{ date: 1, tvl: 5 }, { date: 2, tvl: st.tvl }]));
  await page.route('https://api.dexscreener.com/**', (r) =>
    // the token-pair endpoint returns a bare array; search returns { pairs }
    handle(r, 'dex', () => (r.request().url().includes('/tokens/v1/') ? pairsPayload().pairs : pairsPayload()))
  );
  return st;
}

export const BREAKPOINTS = [
  { w: 360, h: 780 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
  { w: 1366, h: 768 },
  { w: 1440, h: 900 },
];
