import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FX, BREAKPOINTS, routeLive } from './lib/env.mjs';
import { markupText, scriptText, compareCopy } from './lib/copy.mjs';

const fail = (m) => {
  throw new Error(m);
};
const ok = (c, m) => {
  if (!c) fail(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- page helpers: a handful of long-lived pages keep memory and load time down ---------- */
async function open(ctx, key, o = {}) {
  if (ctx.pages[key]) return ctx.pages[key];
  const { build = 'default', mode = 'ok', bp = { w: 1440, h: 900 }, reduced = false, clock = false, perms = false, track = true, flashProbe = false, firstProbe = false } = o;
  const context = await ctx.browser.newContext({
    viewport: { width: bp.w, height: bp.h },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    permissions: perms ? ['clipboard-read', 'clipboard-write'] : [],
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.__clock = clock;
  page.__warns = [];
  page.__dex = [];
  page.on('response', async (r) => {
    if (r.url().includes('dexscreener')) page.__dex.push(r.url().slice(-40) + ' ' + r.status() + ' ' + (await r.text().catch(() => '?')).slice(0, 50));
  });
  page.on('console', (m) => m.type() === 'warning' && page.__warns.push(m.text().slice(0, 120)));
  if (track) {
    page.on('console', (m) => m.type() === 'error' && ctx.errors.push(`console: ${m.text()}`));
    page.on('pageerror', (e) => ctx.errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => {
      const why = (r.failure() && r.failure().errorText) || '';
      if (!/ERR_ABORTED|aborted/i.test(why)) ctx.errors.push(`requestfailed: ${r.url()} ${why}`);
    });
    page.on('request', (r) => ctx.origins.add(new URL(r.url()).origin));
  }
  if (flashProbe) {
    await page.addInitScript(() => {
      window.__flash = 0;
      new MutationObserver((ms) =>
        ms.forEach((m) => {
          if (m.target.classList && m.target.classList.contains('flash')) window.__flash++;
        })
      ).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
  }
  if (firstProbe) {
    // records what each live value shows the instant its number is first written
    await page.addInitScript(() => {
      window.__first = {};
      new MutationObserver((ms) =>
        ms.forEach((m) => {
          const k = m.target.getAttribute && m.target.getAttribute('data-live');
          if (k && !(k in window.__first)) window.__first[k] = m.target.textContent;
        })
      ).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-value'] });
    });
  }
  if (clock) {
    // frozen from the first frame: only tick() moves time, so animations are deterministic on a slow host
    const t0 = new Date('2026-01-01T00:00:00Z');
    await page.clock.install({ time: t0 });
    await page.clock.pauseAt(new Date(t0.getTime() + 1000));
  }
  const live = await routeLive(page, mode);
  await page.goto(ctx.servers[build].url, { waitUntil: 'load', timeout: 60000 });
  return (ctx.pages[key] = { page, live, context, key });
}

async function release(ctx, key) {
  const h = ctx.pages[key];
  if (!h) return;
  delete ctx.pages[key];
  try {
    await h.context.close();
  } catch {}
}

async function tick(page, ms) {
  if (page.__clock) {
    await page.clock.runFor(ms);
    await sleep(12);
  } else await sleep(Math.min(ms, 60));
}

async function until(page, fn, arg, maxMs = 12000, step = 100) {
  for (let t = 0; t <= maxMs; t += step) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    await tick(page, step);
  }
  const diag = await page.evaluate(() => ({ hidden: document.hidden, pill: document.getElementById('status-pill') && document.getElementById('status-pill').dataset.status, pairs: ((document.getElementById('pairs-list') || {}).innerText || '').slice(0, 40) })).catch(() => ({}));
  diag.warns = (page.__warns || []).slice(-2);
  diag.dex = (page.__dex || []).slice(-2);
  diag.url = page.url();
  fail('condition not met in time: ' + String(fn).slice(0, 90) + ' ' + JSON.stringify(diag));
}

const dataReady = () => [...document.querySelectorAll('[data-live="block"],[data-live="tvl"]')].every((e) => e.dataset.value);
const pairsReady = () => !!document.querySelector('.pair-link');
const textOf = (page) =>
  page.evaluate(() => {
    const bits = [document.body.innerText, document.title];
    document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"]').forEach((m) => bits.push(m.content));
    document.querySelectorAll('[aria-label],[title]').forEach((e) => bits.push(e.getAttribute('aria-label') || '', e.getAttribute('title') || ''));
    return bits.join('\n');
  });

/** Reduced-motion layout pages: loaded once per build, resized per breakpoint. */
async function layout(ctx, build) {
  const key = 'layout-' + build;
  const fresh = !ctx.pages[key];
  const h = await open(ctx, key, { build, reduced: true, perms: true, firstProbe: build === 'default' });
  if (fresh) {
    await until(h.page, dataReady, undefined, 8000);
    await until(h.page, pairsReady, undefined, 8000);
    ctx.corpus.push(await textOf(h.page));
  }
  return h;
}
async function setBp(h, bp) {
  await h.page.bringToFront();
  await h.page.setViewportSize({ width: bp.w, height: bp.h });
  await h.page.evaluate(() => window.scrollTo(0, 0));
  await sleep(250);
}

/* ---------- in-page measurement fragments ---------- */
const overflowProbe = () => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth) out.push(`document scrollWidth ${doc.scrollWidth} > ${doc.clientWidth}`);
  const clipped = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(p).overflowX)) return true;
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if ((r.right > vw + 0.5 || r.left < -0.5) && !clipped(el)) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`);
  }
  for (const sel of ['.topbar-inner', '.nav', '.stat-card', '.band-stat', '.pair-link', '.ca-btn', '.step', '.feature', '.status-pill', '.cta', '.cta-big']) {
    document.querySelectorAll(sel).forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) out.push(`${sel} content wider than box (${el.scrollWidth} > ${el.clientWidth})`);
    });
  }
  return out.slice(0, 10);
};

const tapProbe = () => {
  const bad = [];
  const sel = 'a[href], button, [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  let n = 0;
  document.querySelectorAll(sel).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (getComputedStyle(el).display === 'none') return;
    n++;
    if (r.width < 47.5 || r.height < 47.5) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`);
  });
  return { n, bad };
};

/* ========================================================= */
export const browserGates = [
  {
    name: 'no-overflow-5-breakpoints',
    async run(ctx) {
      for (const build of ['default', 'stated']) {
        const h = await layout(ctx, build);
        for (const bp of BREAKPOINTS) {
          await setBp(h, bp);
          const a = await h.page.evaluate(overflowProbe);
          await h.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await sleep(60);
          const b = await h.page.evaluate(overflowProbe);
          ok(!a.length && !b.length, `${build} @${bp.w}: ${[...a, ...b].join(' | ')}`);
        }
      }
      return '360/390/430/1366/1440 x absent+stated: no horizontal overflow, no clipped content';
    },
  },
  {
    name: 'tap-targets-48px-5-breakpoints',
    async run(ctx) {
      let total = 0;
      for (const build of ['default', 'stated']) {
        const h = await layout(ctx, build);
        for (const bp of BREAKPOINTS) {
          await setBp(h, bp);
          const { n, bad } = await h.page.evaluate(tapProbe);
          total += n;
          ok(n > 0, `${build} @${bp.w}: found no interactive elements`);
          ok(!bad.length, `${build} @${bp.w}: under 48px -> ${bad.join(' | ')}`);
        }
      }
      return `${total} targets measured, all >= 48px`;
    },
  },
  {
    name: 'ca-slot-top-full-address',
    async run(ctx) {
      const h = await layout(ctx, 'stated');
      for (const bp of BREAKPOINTS) {
        await setBp(h, bp);
        const m = await h.page.evaluate(() => {
          const slot = document.getElementById('ca-slot').getBoundingClientRect();
          const val = document.getElementById('ca-val');
          const cs = getComputedStyle(val);
          const vw = document.documentElement.clientWidth;
          const r = val.getBoundingClientRect();
          const before = { top: slot.top, bottom: slot.bottom };
          window.scrollTo(0, document.body.scrollHeight);
          const after = document.getElementById('ca-slot').getBoundingClientRect();
          return { text: val.textContent, fits: val.scrollWidth <= val.clientWidth + 1, ellipsis: cs.textOverflow === 'ellipsis', inView: r.left >= 0 && r.right <= vw && r.top >= 0, before, afterTop: after.top, barH: document.getElementById('topbar').getBoundingClientRect().height };
        });
        ok(m.text === FX.address && m.text.length === 42, `@${bp.w}: slot text is not the full 42-char address: ${m.text}`);
        ok(m.fits && !m.ellipsis, `@${bp.w}: address truncated`);
        ok(m.inView, `@${bp.w}: address leaves the viewport`);
        ok(m.before.top >= 0 && m.before.top < 20 && m.before.bottom <= 90, `@${bp.w}: slot not at the top (${JSON.stringify(m.before)})`);
        ok(m.afterTop >= 0 && m.afterTop < 20, `@${bp.w}: slot not always visible after scrolling`);
        ok(m.barH <= 90, `@${bp.w}: top strip too tall (${m.barH})`);
      }
      return 'full 42-char address visible, untruncated, pinned at top, 5 widths';
    },
  },
  {
    name: 'ca-absent-inert-no-date',
    async run(ctx) {
      const h = await layout(ctx, 'default');
      await setBp(h, { w: 1440, h: 900 });
      if (ctx.register.ca.state === 'stated') {
        // real register is stated: the slot must be live, show the full address and stay at the top
        const s = await h.page.evaluate(() => ({ state: document.getElementById('ca-slot').dataset.state, text: document.getElementById('ca-val').textContent, disabled: document.getElementById('ca-btn').disabled }));
        ok(s.state === 'stated' && !s.disabled && s.text === ctx.register.ca.value, 'stated slot must be live and show the full address: ' + JSON.stringify(s));
        return 'register ca is stated: slot is live and shows the full address (inert branch skipped)';
      }
      await h.page.evaluate(() => navigator.clipboard.writeText('sentinel'));
      const m = await h.page.evaluate(() => {
        const slot = document.getElementById('ca-slot');
        const btn = document.getElementById('ca-btn');
        btn.click();
        return { state: slot.dataset.state, disabled: btn.disabled, aria: btn.getAttribute('aria-disabled'), text: slot.textContent.replace(/\s+/g, ' ').trim(), anchors: slot.querySelectorAll('a').length, toast: !!document.querySelector('.site-toast'), visible: slot.getBoundingClientRect().height > 0 };
      });
      const clip = await h.page.evaluate(() => navigator.clipboard.readText());
      ok(m.visible, 'slot must stay visible while absent');
      ok(m.state === 'absent' && m.disabled && m.aria === 'true', 'slot must be inert while absent');
      ok(m.anchors === 0 && !m.toast && clip === 'sentinel', 'inert slot reacted to a click');
      ok(!/0x/i.test(m.text), 'absent slot shows hex');
      const dateRe = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(?:19|20)\d\d\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\bQ[1-4]\b|\bsoon\b|\btomorrow\b|\bnext (?:week|month)\b|\blaunch(?:es|ing)? (?:on|in)\b/i;
      ok(!dateRe.test(m.text), `absent slot mentions a date or timing: "${m.text}"`);
      return `inert, visible, no date ("${m.text}")`;
    },
  },
  {
    name: 'ca-stated-click-to-copy',
    async run(ctx) {
      const h = await layout(ctx, 'stated');
      await setBp(h, { w: 1440, h: 900 });
      await h.page.evaluate(() => navigator.clipboard.writeText('sentinel'));
      const st = await h.page.evaluate(() => ({ disabled: document.getElementById('ca-btn').disabled, state: document.getElementById('ca-slot').dataset.state }));
      ok(!st.disabled && st.state === 'stated', 'stated slot must be live');
      await h.page.click('#ca-btn');
      await until(h.page, () => !!document.querySelector('.site-toast'), undefined, 3000, 50);
      const clip = await h.page.evaluate(() => navigator.clipboard.readText());
      const toast = await h.page.evaluate(() => ({ role: document.querySelector('.site-toast').getAttribute('role'), text: document.querySelector('.site-toast').textContent }));
      ok(clip === FX.address, `clipboard holds "${clip}"`);
      ok(toast.role === 'status', 'toast needs role=status');
      ctx.corpus.push(toast.text);
      await sleep(2900);
      ok(await h.page.evaluate(() => !document.querySelector('.site-toast')), 'toast did not dismiss');
      return 'click copies the exact address; toast announces then leaves';
    },
  },
  {
    name: 'socials-top-right-link-rule',
    async run(ctx) {
      const d = await layout(ctx, 'default');
      for (const bp of BREAKPOINTS) {
        await setBp(d, bp);
        const m = await d.page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const slots = [...document.querySelectorAll('.social-slot')].map((s) => {
            const el = s.firstElementChild;
            const r = el.getBoundingClientRect();
            return { tag: el.tagName, text: el.textContent.trim(), href: el.getAttribute('href'), disabled: el.disabled === true && el.getAttribute('aria-disabled') === 'true', right: vw - r.right, top: r.top };
          });
          const strayLinks = [...document.querySelectorAll('a[href]')].filter((a) => /(^|\.)(x|twitter|github)\.com$/i.test(new URL(a.href, location.href).hostname)).length;
          return { slots, strayLinks };
        });
        ok(m.slots.length === 2, `@${bp.w}: expected two social slots`);
        m.slots.forEach((s) => {
          ok(s.text === '' && s.tag === 'BUTTON' && s.href === null && s.disabled, `@${bp.w}: absent social must be an inert, icon-only button without href (${JSON.stringify(s)})`);
          ok(s.right >= 0 && s.right < 140 && s.top < 70, `@${bp.w}: social not top-right (${Math.round(s.right)}px from right, ${Math.round(s.top)} from top)`);
        });
        ok(m.strayLinks === 0, `@${bp.w}: href to x.com/github.com exists while records are absent`);
      }
      const h = await layout(ctx, 'stated');
      const s = await h.page.evaluate(() => [...document.querySelectorAll('.social-slot > *')].map((el) => ({ tag: el.tagName, href: el.href, text: el.textContent.trim(), label: el.getAttribute('aria-label'), rel: el.rel, target: el.target })));
      ok(s[0].tag === 'A' && s[0].href === FX.x && s[0].label.includes('@fixture_handle'), 'x: stated link must use the stored URL and a derived handle');
      ok(s[1].tag === 'A' && s[1].href === FX.github && s[1].label.includes('@fixture-org'), 'github: stated link must use the stored URL and a derived handle');
      ok(s.every((e) => e.text === '' && /noopener/.test(e.rel) && e.target === '_blank'), 'stated socials: icon-only, noopener');
      return 'absent: inert icon buttons, zero hrefs; stated: href from URL, handle derived';
    },
  },
  {
    name: 'skeletons-while-loading',
    async run(ctx) {
      const h = await open(ctx, 'slow', { mode: 'slow', clock: true });
      await tick(h.page, 500);
      const m = await h.page.evaluate(() => {
        const vals = [...document.querySelectorAll('[data-live]')];
        const sk = document.querySelector('.stat-card .skeleton');
        return { n: vals.length, withSkeleton: vals.filter((v) => v.querySelector('.skeleton')).length, busy: vals.filter((v) => v.getAttribute('aria-busy') === 'true').length, pairRows: document.querySelectorAll('.pair-row .skeleton').length, anim: sk ? getComputedStyle(sk).animationName : 'none', status: document.getElementById('status-pill').dataset.status };
      });
      ok(m.n >= 6 && m.withSkeleton === m.n && m.busy === m.n, `every live value needs a skeleton + aria-busy (${JSON.stringify(m)})`);
      ok(m.pairRows >= 3, 'pairs list needs skeleton rows');
      ok(m.anim !== 'none', 'skeleton does not animate');
      ok(m.status === 'loading', 'status pill should read loading');
      h.live.release();
      await until(h.page, dataReady, undefined, 10000);
      await until(h.page, pairsReady, undefined, 10000);
      const after = await h.page.evaluate(() => ({ left: document.querySelectorAll('.skeleton').length, busy: document.querySelectorAll('[aria-busy="true"]').length }));
      await release(ctx, 'slow');
      ok(after.left === 0 && after.busy === 0, `skeletons left behind: ${JSON.stringify(after)}`);
      return `${m.n} live values + pair rows show skeletons, then clear`;
    },
  },
  {
    name: 'live-values-and-pairs',
    async run(ctx) {
      const h = await layout(ctx, 'stated');
      await until(h.page, () => document.querySelector('[data-live="gas"]').dataset.value, undefined, 3000);
      const m = await h.page.evaluate(() => {
        const g = (k) => [...document.querySelectorAll(`[data-live="${k}"]`)].map((e) => ({ v: e.dataset.value, t: e.textContent }));
        const rows = [...document.querySelectorAll('.pair-link')].map((a) => ({ tag: a.tagName, href: a.getAttribute('href'), name: a.querySelector('.pair-name').firstChild.textContent }));
        return { block: g('block').concat(g('block-big')), gas: g('gas').concat(g('gas-big')), tvl: g('tvl').concat(g('tvl-big')), rows, pill: document.getElementById('status-pill').dataset.status };
      });
      m.block.forEach((b) => ok(b.v === String(FX.block) && b.t === FX.block.toLocaleString('en-US'), `block rendered "${b.t}"`));
      const gasText = (FX.gweiWei / 1e9).toFixed(4);
      m.gas.forEach((b) => ok(b.t === gasText, `gas rendered "${b.t}", expected "${gasText}"`));
      m.tvl.forEach((b) => ok(b.t === '$1.23B' && b.v === String(FX.tvl), `tvl rendered "${b.t}"`));
      ok(m.rows.length === 2, `expected 2 pair rows (foreign-chain pair filtered), got ${m.rows.length}`);
      ok(m.rows[0].name.startsWith('BBB'), 'pairs must sort by liquidity, highest first');
      const long = m.rows.find((r) => r.name.startsWith('AAA'));
      ok(long && long.tag === 'A' && long.href.endsWith(FX.pairId64), '64-hex pool id must be accepted and linked, not rejected as a non-address');
      ok(m.rows.every((r) => r.tag !== 'A' || r.href.startsWith('https://dexscreener.com/robinhood/0x')), 'pair links must derive from the registered DexScreener URL');
      ok(m.pill === 'live', `status pill should be live, is ${m.pill}`);
      return 'block, gas, TVL and pairs render from synthetic feeds (token-pair endpoint used when CA is stated)';
    },
  },
  {
    name: 'countup-and-flash-on-change',
    async run(ctx) {
      const h = await open(ctx, 'countup', { clock: true, flashProbe: true });
      const seen = [];
      for (let i = 0; i < 80; i++) {
        const t = await h.page.evaluate(() => {
          const e = document.querySelector('.band [data-live="block-big"]');
          return { v: e.dataset.value || '', t: e.textContent };
        });
        const n = parseInt(t.t.replace(/[^\d]/g, ''), 10);
        if (Number.isFinite(n)) seen.push(n);
        if (t.v && n === FX.block) break;
        await tick(h.page, 100);
      }
      const mid = seen.filter((n) => n > 0 && n < FX.block);
      ok(mid.length >= 1, `count-up never showed an intermediate value (${seen.slice(0, 8).join(',')})`);
      ok(seen[seen.length - 1] === FX.block, 'count-up did not land on the exact value');
      ok((await h.page.evaluate(() => window.__flash)) === 0, 'first load must count up without a change flash');
      h.live.block = FX.blockNext;
      await until(h.page, (v) => document.querySelector('.band [data-live="block-big"]').dataset.value === String(v), FX.blockNext, 20000, 200);
      await tick(h.page, 1500);
      const f = await h.page.evaluate(() => ({ flashes: window.__flash, text: document.querySelector('.band [data-live="block-big"]').textContent }));
      await release(ctx, 'countup');
      ok(f.flashes >= 1, 'a changed value must flash');
      ok(f.text === FX.blockNext.toLocaleString('en-US'), `final text after change: ${f.text}`);
      return `${mid.length} intermediate frames; flash on change; exact landing`;
    },
  },
  {
    name: 'failure-shows-unavailable-not-zero',
    async run(ctx) {
      const h = await open(ctx, 'fail', { mode: 'fail', clock: true, track: false });
      await until(h.page, () => document.querySelectorAll('.unavailable').length >= 6, undefined, 10000);
      await until(h.page, () => /unavailable/i.test(document.getElementById('pairs-list').textContent), undefined, 10000);
      await tick(h.page, 6500);
      const m = await h.page.evaluate(() => ({ text: document.body.innerText, skeletons: document.querySelectorAll('.skeleton').length, status: document.getElementById('status-pill').dataset.status, statusText: document.getElementById('status-text').textContent, hasValue: document.querySelectorAll('[data-live][data-value]').length }));
      const hits = { ...h.live.hits };
      await release(ctx, 'fail');
      ok(m.skeletons === 0, 'skeleton must not spin forever after a failure');
      ok(!/\b(NaN|undefined|Infinity|null)\b/.test(m.text), 'failure text leaks NaN/undefined');
      ok(m.hasValue === 0, 'a failed read must not render a value (no fake zero)');
      ok(m.status === 'offline', `status should be offline, is ${m.status}`);
      ok(hits.rpc >= 2, 'RPC polling must keep retrying after a failure');
      ctx.corpus.push(m.text);
      return 'unavailable shown, no fake zero, retries continue';
    },
  },
  {
    name: 'copy-original-vs-reference',
    async run(ctx) {
      const ref = JSON.parse(readFileSync(join(ctx.root, 'gates/fixtures/ref-vocab.json'), 'utf8'));
      const blocks = [...ctx.corpus, ...markupText(readFileSync(join(ctx.builds.default, 'index.html'), 'utf8')), ...scriptText(join(ctx.root, 'src/lib'))];
      const r = compareCopy(blocks, ref);
      ok(r.sharedWords.length === 0, `words shared with the reference: ${r.sharedWords.join(', ')}`);
      ok(r.sharedBigrams.length === 0, `2-grams shared with the reference: ${r.sharedBigrams.join(' | ')}`);
      return `${r.nWords} unique words, ${r.nBigrams} 2-grams checked against ${ref.words.length}/${ref.bigrams.length}`;
    },
  },
  {
    name: 'reduced-motion-instant',
    async run(ctx) {
      const h = await layout(ctx, 'default');
      await setBp(h, { w: 1440, h: 900 });
      const m = await h.page.evaluate(() => {
        const nodes = [...document.querySelectorAll('body *')];
        const moving = nodes.filter((e) => {
          const cs = getComputedStyle(e);
          return cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0) || cs.animationName !== 'none';
        });
        const hidden = [...document.querySelectorAll('.anim, .unit, .reveal')].filter((e) => getComputedStyle(e).opacity !== '1');
        return { pre: !!document.getElementById('preloader'), moving: moving.slice(0, 6).map((e) => e.tagName + '.' + e.className), hidden: hidden.length, sb: getComputedStyle(document.documentElement).scrollBehavior, first: window.__first };
      });
      ok(!m.pre, 'preloader must not exist under reduced motion');
      ok(m.moving.length === 0, `elements still animate: ${m.moving.join(', ')}`);
      ok(m.hidden === 0, `${m.hidden} entrance elements still hidden`);
      ok(m.sb === 'auto', 'smooth scrolling must be off');
      ok(m.first && m.first.block === FX.block.toLocaleString('en-US') && m.first.tvl === '$1.23B', `count-up must write the final value at once, first paint showed ${JSON.stringify(m.first)}`);
      const snap = () => h.page.evaluate(() => document.getElementById('dither').toDataURL());
      const s1 = await snap();
      await sleep(500);
      ok(s1 === (await snap()), 'dither must hold still under reduced motion');
      await h.page.evaluate(() => window.scrollTo(0, 800));
      await sleep(100);
      const py = await h.page.evaluate(() => document.querySelector('.dither-bg').style.getPropertyValue('--py'));
      ok(py === '', 'parallax must be off under reduced motion');
      const dot = await h.page.evaluate(() => getComputedStyle(document.querySelector('#status-pill .live-dot'), '::after').animationName);
      ok(dot === 'none', 'status dot must stop pulsing');
      return 'no transitions or animations anywhere; final values at once; dither + parallax still';
    },
  },
  {
    name: 'scroll-progress-bar',
    async run(ctx) {
      const h = await layout(ctx, 'default');
      await setBp(h, { w: 1366, h: 768 });
      const read = () => h.page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('progress-bar')).transform).a);
      const pos = await h.page.evaluate(() => getComputedStyle(document.getElementById('progress')).position);
      const top = await read();
      await h.page.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2));
      let mid = await read();
      for (let i = 0; i < 20 && Math.abs(mid - 0.5) > 0.1; i++) {
        await sleep(150);
        mid = await read();
      }
      await h.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      let bottom = await read();
      for (let i = 0; i < 20 && bottom < 0.99; i++) {
        await sleep(150);
        bottom = await read();
      }
      ok(pos === 'fixed', 'progress bar must be fixed');
      ok(top < 0.02 && mid > 0.4 && mid < 0.6 && bottom > 0.99, `progress readings ${top.toFixed(2)} / ${mid.toFixed(2)} / ${bottom.toFixed(2)}`);
      return `0 -> ${mid.toFixed(2)} -> 1`;
    },
  },
  {
    name: 'nav-anchors-scroll-to-sections',
    async run(ctx) {
      const h = await layout(ctx, 'default');
      for (const bp of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
        await setBp(h, bp);
        const hrefs = await h.page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="#"]')].filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.getAttribute('href')))]);
        ok(hrefs.length >= 2, `@${bp.w}: too few anchors`);
        for (const href of hrefs) {
          if (href === '#home') continue;
          ok(await h.page.evaluate((id) => !!document.getElementById(id), href.slice(1)), `${href} has no target`);
          await h.page.evaluate(() => window.scrollTo(0, 0));
          await h.page.click(`a[href="${href}"]:visible >> nth=0`);
          await sleep(150);
          const top = await h.page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top, href.slice(1));
          ok(top > -5 && top < 160, `@${bp.w}: ${href} lands ${Math.round(top)}px from top`);
        }
      }
      return 'every in-page link lands on its section at both layouts';
    },
  },
  {
    name: 'preloader-and-hero-entrance',
    async run(ctx) {
      await release(ctx, 'layout-default');
      await release(ctx, 'layout-stated');
      const h = await open(ctx, 'motion', { clock: true });
      await tick(h.page, 300);
      const a = await h.page.evaluate(() => ({ present: !!document.getElementById('preloader'), pct: parseInt(document.getElementById('counter').textContent, 10), unitsIn: document.querySelectorAll('.unit.in').length }));
      await tick(h.page, 1000);
      const b = await h.page.evaluate(() => ({ pct: parseInt(document.getElementById('counter').textContent, 10), fill: parseFloat(document.getElementById('fill').style.height) }));
      ok(a.present && a.unitsIn === 0, 'preloader must cover the hero before it finishes');
      ok(b.pct > a.pct && b.fill > 0 && b.pct < 100, `counter not climbing (${a.pct} -> ${b.pct})`);
      await until(h.page, () => !document.getElementById('preloader'), undefined, 6000, 100);
      await tick(h.page, 300);
      const c = await h.page.evaluate(() => {
        const units = [...document.querySelectorAll('.unit')];
        return { total: units.length, in: units.filter((u) => u.classList.contains('in')).length, letters: units.filter((u) => !u.classList.contains('word')).length, anim: [...document.querySelectorAll('#site .anim')].every((e) => e.classList.contains('in')), h1: document.querySelector('h1').getAttribute('aria-label') };
      });
      ok(c.total > 20 && c.in === c.total && c.anim, `hero entrance incomplete (${c.in}/${c.total})`);
      ok(c.letters >= 15, 'headline should be split into letters');
      ok(c.h1 === 'Growth picks up the tab.', 'headline needs an aria-label with the full text');
      await until(h.page, dataReady, undefined, 10000);
      return `curtain 0 -> 100 -> collapse, ${c.total} units entered`;
    },
  },
  {
    name: 'status-pill-pulsing-dot',
    async run(ctx) {
      const h = await open(ctx, 'motion', { clock: true });
      await until(h.page, dataReady, undefined, 10000);
      await until(h.page, pairsReady, undefined, 10000);
      const on = await h.page.evaluate(() => {
        const pill = document.getElementById('status-pill');
        const cs = getComputedStyle(pill.querySelector('.live-dot'), '::after');
        return { anim: cs.animationName, iter: cs.animationIterationCount, dur: cs.animationDuration, status: pill.dataset.status, w: pill.querySelector('.live-dot').getBoundingClientRect().width };
      });
      ok(on.anim === 'pulse' && on.iter === 'infinite' && on.w > 0, `dot should pulse forever (got ${on.anim}/${on.iter})`);
      ok(on.status === 'live', `pill should be live, is ${on.status}`);
      return `pulse ${on.dur} infinite while live`;
    },
  },
  {
    name: 'scroll-reveal-staggered',
    async run(ctx) {
      const h = await open(ctx, 'motion', { clock: true });
      const before = await h.page.evaluate(() => [...document.querySelectorAll('.step')].map((s) => ({ in: s.classList.contains('in'), op: getComputedStyle(s).opacity })));
      ok(before.length === 4 && before.every((s) => !s.in && s.op === '0'), 'steps must start hidden below the fold');
      await h.page.evaluate(() => window.scrollTo(0, document.querySelector('.steps').getBoundingClientRect().top + scrollY - 250));
      await until(h.page, () => [...document.querySelectorAll('.step')].every((s) => s.classList.contains('in')), undefined, 5000, 50);
      const delays = await h.page.evaluate(() => [...document.querySelectorAll('.step')].map((s) => parseFloat(s.style.transitionDelay)));
      ok(delays.join() === '0,80,160,240', `stagger delays ${delays.join()}`);
      await tick(h.page, 1600);
      const cleared = await h.page.evaluate(() => [...document.querySelectorAll('.step')].map((s) => s.style.transitionDelay));
      ok(cleared.every((d) => d === ''), 'entrance delays must be cleared so hovers respond instantly');
      return 'hidden below fold, enters 80ms apart, delays cleared after';
    },
  },
  {
    name: 'parallax-depth',
    async run(ctx) {
      const h = await open(ctx, 'motion', { clock: true });
      await h.page.evaluate(() => window.scrollTo(0, 0));
      await sleep(150);
      await tick(h.page, 200);
      const py = () => h.page.evaluate(() => parseFloat(document.querySelector('.dither-bg').style.getPropertyValue('--py') || '0'));
      const y0 = await py();
      await h.page.evaluate(() => window.scrollTo(0, 400));
      await sleep(150);
      await tick(h.page, 200);
      const y1 = await py();
      ok(Math.abs(y1 - y0) > 5, `hero layer does not move on scroll (${y0} -> ${y1})`);
      ok((await h.page.evaluate(() => getComputedStyle(document.querySelector('.dither-bg')).transform)) !== 'none', 'hero layer has no transform');
      await h.page.evaluate(() => window.scrollTo(0, document.querySelector('.band').getBoundingClientRect().top + scrollY - 300));
      await sleep(150);
      await tick(h.page, 400);
      const g = await h.page.evaluate(() => document.querySelector('.glow').style.getPropertyValue('--py'));
      ok(g !== '' && Number.isFinite(parseFloat(g)), 'band glow has no parallax offset');
      return `hero layer ${y0.toFixed(0)} -> ${y1.toFixed(0)}px, glow offset ${g}`;
    },
  },
  {
    name: 'dither-canvas-two-tone',
    async run(ctx) {
      const h = await open(ctx, 'motion', { clock: true });
      await h.page.evaluate(() => window.scrollTo(0, 0));
      await tick(h.page, 200);
      const grab = () =>
        h.page.evaluate(() => {
          const c = document.getElementById('dither');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          const set = new Set();
          let chroma = 0;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) {
            set.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
            if (d[i] !== d[i + 1] || d[i + 1] !== d[i + 2]) chroma++;
            sum += d[i];
          }
          return { w: c.width, h: c.height, colours: set.size, chroma, sum };
        });
      const a = await grab();
      await h.page.mouse.move(1000, 400);
      await tick(h.page, 1200);
      const b = await grab();
      ok(a.w > 50 && a.h > 50, 'canvas has no resolution');
      ok(a.colours === 2, `expected a two-tone dither, saw ${a.colours} colours`);
      ok(a.sum !== b.sum, 'dither is not animating');
      return `${a.w}x${a.h} two-tone brand field, animating`;
    },
  },
  {
    name: 'hover-and-focus-states',
    async run(ctx) {
      const h = await open(ctx, 'motion', { clock: true });
      await h.page.evaluate(() => window.scrollTo(0, 0));
      await sleep(300);
      const m = await h.page.evaluate(() => {
        const els = [...document.querySelectorAll('a[href], button:not(:disabled)')].filter((e) => e.getBoundingClientRect().width > 0);
        const bad = els.filter((e) => !getComputedStyle(e).transitionDuration.split(',').some((d) => parseFloat(d) > 0)).map((e) => e.tagName + '.' + e.className);
        return { n: els.length, bad };
      });
      ok(m.n >= 10 && m.bad.length === 0, `interactive elements without a hover transition: ${m.bad.join(', ')}`);
      const before = await h.page.evaluate(() => getComputedStyle(document.querySelector('.contact')).transform);
      await h.page.hover('.contact');
      await sleep(500);
      const after = await h.page.evaluate(() => getComputedStyle(document.querySelector('.contact')).transform);
      ok(before !== after, 'hovering the nav button changes nothing');
      await h.page.mouse.move(5, 400);
      await h.page.keyboard.press('Tab');
      await h.page.keyboard.press('Tab');
      const f = await h.page.evaluate(() => {
        const cs = getComputedStyle(document.activeElement);
        return { tag: document.activeElement.tagName, w: parseFloat(cs.outlineWidth), style: cs.outlineStyle };
      });
      ok(f.tag !== 'BODY' && f.style !== 'none' && f.w >= 2, `focus ring missing (${JSON.stringify(f)})`);
      return `${m.n} interactive elements animate; hover + focus ring verified`;
    },
  },
  {
    name: 'meta-favicon-and-sampled-pixels',
    async run(ctx) {
      const dist = ctx.builds.default;
      const html = readFileSync(join(dist, 'index.html'), 'utf8');
      const pick = (re) => (html.match(re) || [])[1];
      const title = pick(/<title>([^<]*)<\/title>/);
      ok(title && title.length <= 70, 'title missing or too long');
      ok(pick(/<meta name="description" content="([^"]{40,220})"/), 'description missing');
      ok(pick(/<link rel="canonical" href="([^"]*)"/) === 'https://accrue.onl/', 'canonical must be https://accrue.onl/');
      ok(/<meta name="theme-color" content="#[0-9a-f]{6}"/.test(html), 'theme-color must be built from tokens');
      ok(/<link rel="icon" href="\/favicon-32\.png"/.test(html) && /apple-touch-icon/.test(html), 'icon links missing');
      ok(ctx.register.ogImage.state === 'stated' ? /og:image" content="https:\/\/accrue\.onl\/og\.jpg"/.test(html) && existsSync(join(dist, 'og.jpg')) : !/og:image/.test(html), 'og:image must match the register');
      const ihdr = (f) => {
        const b = readFileSync(join(dist, f));
        return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colour: b[25] };
      };
      for (const [f, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180], ['logo-256.png', 256]]) {
        const i = ihdr(f);
        ok(i.w === size && i.h === size && i.colour === 6, `${f} should be ${size}x${size} RGBA, is ${JSON.stringify(i)}`);
      }
      // decode in the browser: sampled pixels must be real, and the resize must not leave dark fringes
      const sampled = JSON.parse(readFileSync(join(ctx.root, 'tools/palette.sampled.json'), 'utf8'));
      const page = await ctx.browser.newPage();
      try {
        await page.goto('about:blank');
        const files = [...new Set(Object.values(sampled.samples).map((s) => s.file))];
        for (const file of files) {
          const ext = file.endsWith('.png') ? 'png' : 'jpeg';
          const b64 = readFileSync(join(ctx.root, file)).toString('base64');
          const pts = Object.entries(sampled.samples).filter(([, s]) => s.file === file);
          const got = await page.evaluate(async ([src, pts]) => {
            const img = new Image();
            img.src = src;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const x = c.getContext('2d', { willReadFrequently: true });
            x.drawImage(img, 0, 0);
            return pts.map(([t, s]) => [t, Array.from(x.getImageData(s.x, s.y, 1, 1).data.slice(0, 3))]);
          }, ['data:image/' + ext + ';base64,' + b64, pts]);
          for (const [t, rgb] of got) ok(rgb.join() === sampled.samples[t].rgb.join(), `--${t}: pixel at (${sampled.samples[t].x}, ${sampled.samples[t].y}) of ${file} is rgb(${rgb}), expected rgb(${sampled.samples[t].rgb})`);
        }
        const fav = readFileSync(join(dist, 'favicon-32.png')).toString('base64');
        const fringe = await page.evaluate(async (src) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = c.height = 32;
          const x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(img, 0, 0);
          const d = x.getImageData(0, 0, 32, 32).data;
          let edge = 0, dark = 0, solid = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] === 255) solid++;
            if (d[i + 3] > 0 && d[i + 3] < 255) {
              edge++;
              // un-premultiplied colour of an edge pixel must stay a logo colour, never drift toward black
              if (Math.max(d[i], d[i + 1], d[i + 2]) < 90) dark++;
            }
          }
          return { edge, dark, solid };
        }, 'data:image/png;base64,' + fav);
        ok(fringe.solid > 100 && fringe.edge > 0, 'favicon has no logo pixels');
        ok(fringe.dark === 0, `favicon edge has ${fringe.dark} dark fringe pixels: resize was not premultiplied`);
      } finally {
        await page.close();
      }
      return `${Object.keys(sampled.samples).length} sampled pixels verified in their source files; icons RGBA; no dark fringe`;
    },
  },
  {
    name: 'console-and-network-clean',
    async run(ctx) {
      const allowed = new Set([ctx.servers.default.url.replace(/\/$/, ''), ctx.servers.stated.url.replace(/\/$/, ''), 'https://rpc.mainnet.chain.robinhood.com', 'https://api.llama.fi', 'https://api.dexscreener.com']);
      const stray = [...ctx.origins].filter((o) => !allowed.has(o));
      ok(!ctx.errors.length, `console/page errors:\n  ${ctx.errors.slice(0, 6).join('\n  ')}`);
      ok(!stray.length, `unexpected third-party origins: ${stray.join(', ')}`);
      return `0 errors; ${ctx.origins.size} origins (local + 3 data hosts only; fonts self-hosted)`;
    },
  },
];
