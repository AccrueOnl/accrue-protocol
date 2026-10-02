import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function toOklch(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb) };
}

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function walk(dir, skip = () => false, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (skip(p, name)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, skip, out);
    else out.push(p);
  }
  return out;
}

const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');
const fail = (m) => {
  throw new Error(m);
};
const ok = (c, m) => {
  if (!c) fail(m);
};

const SKIP_PROJECT = (p, name) => ['node_modules', '.gate', 'dist', 'package-lock.json'].includes(name);

/* ---- colour literal detection (CSS declarations and JS strings only, so #ids and 0x hex are never flagged) ---- */
const FUNC_RE = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[-\d.]/;
const HEX_VALUE_RE = /(?:^|[\s:(,])#[0-9a-fA-F]{3,8}(?![\w-])/;
function colourLiterals(file, text) {
  const hits = [];
  const ext = extname(file);
  if (ext === '.css') {
    for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
      for (const decl of m[1].split(';')) {
        if (FUNC_RE.test(decl) || HEX_VALUE_RE.test(decl)) hits.push(decl.trim().slice(0, 80));
      }
    }
  } else {
    if (FUNC_RE.test(text)) hits.push('colour function');
    for (const m of text.matchAll(/(['"`])(#[0-9a-fA-F]{3,8})\1/g)) hits.push(m[2]);
    if (ext === '.html') for (const m of text.matchAll(/style="([^"]*)"/g)) if (HEX_VALUE_RE.test(m[1])) hits.push(m[1]);
  }
  return hits;
}

export const staticGates = [
  {
    name: 'tokens-only-literals',
    run() {
      const files = [join(ROOT, 'index.html'), join(ROOT, 'vite.config.js'), ...walk(join(ROOT, 'src')), ...(existsSync(join(ROOT, 'public')) ? walk(join(ROOT, 'public')) : [])].filter(
        (f) => /\.(css|js|html|svg|mjs)$/.test(f) && basename(f) !== 'tokens.css'
      );
      const bad = [];
      for (const f of files) {
        const hits = colourLiterals(f, read(f));
        if (hits.length) bad.push(`${rel(f)}: ${hits.join(' | ')}`);
      }
      ok(!bad.length, 'colour literals outside tokens.css:\n  ' + bad.join('\n  '));
      const tokens = read(join(ROOT, 'src/tokens.css'));
      ok(/--paper:/.test(tokens) && /--ink:/.test(tokens), 'tokens.css is missing core tokens');
      return `${files.length} files clean`;
    },
  },
  {
    name: 'palette-sampled-provenance',
    run(ctx) {
      const raw = read(join(ROOT, 'src/tokens.css'));
      const body = raw.replace(/\/\*[\s\S]*?\*\//g, '');
      ok(/SAMPLED PALETTE/.test(raw) && !/UNSAMPLED PLACEHOLDER/.test(raw), 'tokens.css must carry the SAMPLED PALETTE provenance comment');
      ok(/k-means/i.test(raw) && /nearest real pixel/i.test(raw), 'provenance comment must state the k-means + pixel-snap method');
      const total = (body.match(/oklch\(/g) || []).length;
      const re = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/g;
      const parsed = [...body.matchAll(re)];
      ok(total > 0 && parsed.length === total, `unparseable colour in tokens.css (${parsed.length}/${total})`);
      ok(!HEX_VALUE_RE.test(body) && !/\b(?:rgba?|hsla?)\(/.test(body), 'tokens.css must use oklch only');
      const chromatic = parsed.filter((m) => parseFloat(m[2]) > 0.04).length;
      ok(chromatic >= 6, 'sampled palette should be chromatic (brand gradient missing?)');
      const sampled = JSON.parse(read(join(ROOT, 'tools/palette.sampled.json')));
      const names = Object.keys(sampled.samples);
      for (const need of ['brand-1', 'brand-6', 'accent', 'navy', 'ink', 'night', 'paper', 'paper-raised']) ok(names.includes(need), `sample for --${need} missing`);
      for (const [token, smp] of Object.entries(sampled.samples)) {
        const m = raw.match(new RegExp('--' + token + ':\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)'));
        ok(m, `--${token} not declared in tokens.css`);
        const want = ctx.toOklch(...smp.rgb);
        ok(Math.abs(parseFloat(m[1]) - want.L) < 0.002 && Math.abs(parseFloat(m[2]) - want.C) < 0.002, `--${token} does not match its sampled pixel rgb(${smp.rgb})`);
        ok(typeof smp.file === 'string' && Number.isInteger(smp.x) && Number.isInteger(smp.y), `--${token} lacks pixel coordinates`);
      }
      const logo = Object.entries(sampled.files).find(([, v]) => v.pureBlackTransparentPixels > 0);
      ok(logo && existsSync(join(ROOT, 'public/favicon-32.png')), 'transparent logo found with black transparent pixels: premultiplied favicon must exist');
      const brand = existsSync(join(ROOT, 'brand')) ? readdirSync(join(ROOT, 'brand')).length : 0;
      ok(brand > 0 && ctx.register.brandAssets.state === 'stated', 'brand/ has files, so brandAssets must be stated');
      return `${parsed.length} tokens, ${names.length} sampled with pixel coordinates, ${chromatic} chromatic`;
    },
  },
  {
    name: 'repo-hygiene',
    run() {
      const frag = (...a) => a.join('');
      const patterns = [
        new RegExp(frag('cla', 'ude'), 'i'),
        new RegExp(frag('anthr', 'opic'), 'i'),
        new RegExp(frag('co-auth', 'ored-by'), 'i'),
        new RegExp(frag('generated ', '(?:with|by)'), 'i'),
        new RegExp(frag('\\bA', 'I[- ]generated'), 'i'),
      ];
      const files = walk(ROOT, SKIP_PROJECT);
      const bad = [];
      for (const f of files) {
        const name = basename(f).toLowerCase();
        if (name === frag('cla', 'ude.md')) bad.push(`${rel(f)}: forbidden file`);
        if (rel(f).split('/').some((s) => s === frag('.cla', 'ude'))) bad.push(`${rel(f)}: forbidden directory`);
        if (!/\.(css|js|mjs|html|json|svg|md|txt)$/.test(f)) continue;
        const text = read(f);
        for (const p of patterns) if (p.test(text)) bad.push(`${rel(f)}: matches ${p}`);
      }
      ok(!existsSync(join(ROOT, frag('.cla', 'ude'))), 'forbidden config directory present');
      ok(!bad.length, 'hygiene violations:\n  ' + bad.join('\n  '));
      return `${files.length} files scanned`;
    },
  },
  {
    name: 'registry-schema',
    run(ctx) {
      const { register, STATES } = ctx;
      const { isAddress } = ctx.facts;
      const links = ['llamaUrl', 'dexUrl', 'rpc', 'x', 'github'];
      for (const [k, r] of Object.entries(register)) {
        ok(STATES.includes(r.state), `${k}: invalid state ${r.state}`);
        ok(typeof r.label === 'string' && r.label, `${k}: missing label`);
        if (r.state === 'stated') ok(r.value !== null && r.value !== undefined && r.value !== '', `${k}: stated without a value`);
        else ok(r.value === null, `${k}: ${r.state} record must not carry a value`);
        if (r.state === 'stated' && links.includes(k)) ok(/^https:\/\/[^\s]+$/.test(r.value), `${k}: link records store an https URL`);
        if (k === 'ca' && r.state === 'stated') ok(isAddress(r.value), 'ca: stated but not a valid 0x address');
        if (k === 'x' || k === 'github') ok(!('handle' in r), `${k}: store the URL only; the handle is derived`);
      }
      for (const k of ['ca', 'x', 'github', 'domain', 'chainId', 'rpc', 'launch']) ok(k in register, `register is missing ${k}`);
      ok(register.launch.state === 'absent', 'launch must stay absent: no date is ever shown');
      return `${Object.keys(register).length} records valid`;
    },
  },
  {
    name: 'address-validator-not-blanket',
    run(ctx) {
      const { isAddress, handleOf, linkOf } = ctx.facts;
      const lower = '0x' + 'ab'.repeat(20);
      const upper = '0x' + 'AB'.repeat(20);
      const mixed = ctx.FX.address;
      for (const a of [lower, upper, mixed, '0x' + '0123456789'.repeat(4)]) ok(isAddress(a), `valid address rejected: ${a}`);
      const bad = ['0x' + 'ab'.repeat(19), '0x' + 'ab'.repeat(21), 'ab'.repeat(20), '0X' + 'ab'.repeat(20), '0x' + 'zz'.repeat(20), '', null, undefined, 42, ' ' + lower];
      for (const a of bad) ok(!isAddress(a), `invalid address accepted: ${String(a)}`);
      ok(!isAddress('0x' + '1f'.repeat(32)), 'a 64-hex id is not an address');
      ok(handleOf('https://x.com/some_handle') === '@some_handle', 'handle derivation');
      ok(linkOf({ state: 'absent', value: null }) === null, 'absent record must not link');
      ok(linkOf({ state: 'unconfirmed', value: 'https://x.com/a' }) === null, 'unconfirmed record must not link');
      ok(linkOf({ state: 'stated', value: 'http://x.com/a' }) === null, 'non-https must not link');
      ok(linkOf({ state: 'stated', value: 'https://x.com/a' }) === 'https://x.com/a', 'stated https link');
      // the source must never carry a blanket 0x rejection
      for (const f of walk(join(ROOT, 'src')).filter((x) => x.endsWith('.js'))) {
        const t = read(f);
        ok(!/\/\^?0x\/\.test|startsWith\(['"]0x['"]\)\s*\)\s*(?:return|throw)|includes\(['"]0x['"]\)/.test(t), `${rel(f)}: looks like a blanket 0x rejection`);
      }
      return 'accepts 40-hex in any case; rejects malformed; no blanket 0x filter';
    },
  },
  {
    name: 'no-fabricated-address',
    run(ctx) {
      const scan = (dir) =>
        walk(dir)
          .filter((f) => /\.(html|js|css|svg)$/.test(f))
          .filter((f) => /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/.test(read(f)));
      const dflt = scan(ctx.builds.default);
      const live = ctx.register.ca;
      if (live.state === 'stated') {
        // real register is stated: the default build must carry exactly that address and no other
        ok(dflt.length > 0, 'ca is stated but the default build does not carry it');
        const found = new Set();
        for (const f of walk(ctx.builds.default).filter((x) => /\.(html|js|css|svg)$/.test(x))) for (const m of read(f).matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) found.add(m[0]);
        ok([...found].every((a) => a === live.value), 'default build carries an address other than the stated one: ' + [...found].join(', '));
      } else {
        ok(dflt.length === 0, 'default build contains a 40-hex address although ca is absent: ' + dflt.map(rel).join(', '));
      }
      const stated = scan(ctx.builds.stated);
      ok(stated.length > 0, 'stated build should carry the fixture address (scan would be blanket otherwise)');
      return live.state === 'stated' ? 'register ca is stated: default build carries exactly that address; fixture build carries its own' : 'absent build has none; stated build carries the fixture address';
    },
  },
  {
    name: 'no-ch-units',
    run() {
      const files = [join(ROOT, 'index.html'), ...walk(join(ROOT, 'src'))].filter((f) => /\.(css|js|html)$/.test(f));
      const bad = [];
      const re = /(?<![\w.#-])(?:\d+\.?\d*|\.\d+)\s?ch(?![\w-])/g;
      for (const f of files) {
        const t = read(f);
        const hits = t.match(re);
        if (hits) bad.push(`${rel(f)}: ${hits.join(', ')}`);
      }
      ok(!bad.length, 'ch units found:\n  ' + bad.join('\n  '));
      return `${files.length} files clean`;
    },
  },
];

export async function loadModules() {
  const registryMod = await import(pathToFileURL(join(ROOT, 'src/registry.js')).href);
  const facts = await import(pathToFileURL(join(ROOT, 'src/facts.js')).href);
  return { register: registryMod.register, STATES: registryMod.STATES, facts, toOklch };
}
