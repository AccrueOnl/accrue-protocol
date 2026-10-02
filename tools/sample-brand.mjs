/*
  Samples the real brand assets and regenerates:
    - src/tokens.css            (palette, with provenance comment)
    - tools/palette.sampled.json (every sampled token: file, x, y, rgb)
    - public/favicon-32.png, public/apple-touch-icon.png, public/logo-256.png (premultiplied resize)
  Run: node tools/sample-brand.mjs
*/
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BRAND = join(ROOT, 'brand');
const REF = join(ROOT, 'reference');

/* ---------------- PNG decode / encode ---------------- */
function readPng(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG: ' + file);
  let p = 8;
  let ihdr = null;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], colour: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  if (ihdr.depth !== 8 || ihdr.interlace !== 0 || ![2, 6].includes(ihdr.colour)) throw new Error('unsupported PNG layout: ' + JSON.stringify(ihdr));
  const bpp = ihdr.colour === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * bpp;
  const out = Buffer.alloc(ihdr.h * ihdr.w * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const up = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + up - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < ihdr.w; x++) {
      const o = (y * ihdr.w + x) * 4;
      out[o] = line[x * bpp];
      out[o + 1] = line[x * bpp + 1];
      out[o + 2] = line[x * bpp + 2];
      out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { ...ihdr, data: out };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

/* ---------------- colour maths ---------------- */
const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function toOklab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function toOklch(r, g, b) {
  const [L, a, bb] = toOklab(r, g, b);
  const C = Math.hypot(a, bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h: C < 1e-4 ? 0 : h };
}
const f = (n, d) => String(Number(n.toFixed(d)));
const oklchCss = (c, alpha) => `oklch(${f(c.L, 4)} ${f(c.C, 4)} ${f(c.h, 2)}${alpha === undefined ? '' : ' / ' + alpha})`;
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Deterministic k-means in OKLab (farthest-point init), centroids snapped to the nearest real pixel. */
function kmeansSnap(pixels, k, iters = 30) {
  // pixels: [{x,y,rgb:[r,g,b],lab}]
  const cent = [pixels.reduce((m, p) => (p.lab[1] ** 2 + p.lab[2] ** 2 > m.lab[1] ** 2 + m.lab[2] ** 2 ? p : m)).lab.slice()];
  while (cent.length < k) {
    let best = null, bd = -1;
    for (const p of pixels) {
      const d = Math.min(...cent.map((c) => d2(c, p.lab)));
      if (d > bd) { bd = d; best = p; }
    }
    cent.push(best.lab.slice());
  }
  const sizes = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (const p of pixels) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < k; i++) {
        const d = d2(cent[i], p.lab);
        if (d < bd) { bd = d; bi = i; }
      }
      sum[bi][0] += p.lab[0]; sum[bi][1] += p.lab[1]; sum[bi][2] += p.lab[2]; sum[bi][3]++;
    }
    for (let i = 0; i < k; i++) if (sum[i][3]) { cent[i] = [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]]; sizes[i] = sum[i][3]; }
  }
  return cent.map((c, i) => {
    const snap = pixels.reduce((m, p) => (d2(c, p.lab) < d2(c, m.lab) ? p : m));
    return { ...snap, share: sizes[i] / pixels.length };
  });
}

/* ---------------- premultiplied resize ---------------- */
function resizePremultiplied(img, srcRect, size) {
  const { w } = img;
  const out = Buffer.alloc(size * size * 4);
  const sc = srcRect.s / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = srcRect.x + x * sc, x1 = x0 + sc, y0 = srcRect.y + y * sc, y1 = y0 + sc;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= img.h) { wsum += 0; continue; }
          const wt = (Math.min(x1, xx + 1) - Math.max(x0, xx)) * (Math.min(y1, yy + 1) - Math.max(y0, yy));
          const o = (yy * w + xx) * 4;
          const al = img.data[o + 3] / 255;
          r += img.data[o] * al * wt; g += img.data[o + 1] * al * wt; b += img.data[o + 2] * al * wt; a += al * wt; wsum += wt;
        }
      }
      const total = sc * sc;
      const A = a / total;
      const o = (y * size + x) * 4;
      if (A > 0) {
        out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(Math.min(1, A) * 255);
    }
  }
  return out;
}

/* ---------------- main ---------------- */
const report = { generatedBy: 'tools/sample-brand.mjs', files: {}, samples: {} };

const pngs = readdirSync(BRAND).filter((n) => /\.png$/i.test(n));
let logo = null;
for (const name of pngs) {
  const img = readPng(join(BRAND, name));
  const hist = { transparent: 0, partial: 0, opaque: 0 };
  let blackTransparent = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    if (a === 0) { hist.transparent++; if (img.data[i] === 0 && img.data[i + 1] === 0 && img.data[i + 2] === 0) blackTransparent++; }
    else if (a === 255) hist.opaque++;
    else hist.partial++;
  }
  report.files['brand/' + name] = { width: img.w, height: img.h, bitDepth: img.depth, colourType: img.colour, interlace: img.interlace, alpha: hist, pureBlackTransparentPixels: blackTransparent };
  if (hist.transparent > 0 && !logo) logo = { name, img, blackTransparent };
}
if (!logo) throw new Error('no PNG with a transparent region found in brand/');

/* --- logo gradient: k-means over saturated opaque pixels --- */
const L = logo.img;
const sat = [];
for (let y = 0; y < L.h; y += 5) {
  for (let x = 0; x < L.w; x += 5) {
    const o = (y * L.w + x) * 4;
    if (L.data[o + 3] < 255) continue;
    const lab = toOklab(L.data[o], L.data[o + 1], L.data[o + 2]);
    if (Math.hypot(lab[1], lab[2]) < 0.1) continue;
    sat.push({ x, y, rgb: [L.data[o], L.data[o + 1], L.data[o + 2]], lab });
  }
}
const centres = kmeansSnap(sat, 6);
// snap to the exact full-resolution pixel nearest the centroid
const snapFull = (img, c) => {
  let best = null, bd = Infinity;
  const target = toOklab(...c.rgb);
  for (let y = Math.max(0, c.y - 6); y < Math.min(img.h, c.y + 7); y++) {
    for (let x = Math.max(0, c.x - 6); x < Math.min(img.w, c.x + 7); x++) {
      const o = (y * img.w + x) * 4;
      if (img.data[o + 3] < 255) continue;
      const d = d2(target, toOklab(img.data[o], img.data[o + 1], img.data[o + 2]));
      if (d < bd) { bd = d; best = { x, y, rgb: [img.data[o], img.data[o + 1], img.data[o + 2]] }; }
    }
  }
  return best || c;
};
const brand = centres
  .map((c) => ({ ...snapFull(L, c), share: c.share }))
  .map((c) => ({ ...c, ch: toOklch(...c.rgb) }))
  .sort((a, b) => a.ch.h - b.ch.h);
brand.forEach((c, i) => (report.samples['brand-' + (i + 1)] = { file: 'brand/' + logo.name, x: c.x, y: c.y, rgb: c.rgb, share: Number(c.share.toFixed(3)), method: 'k-means k=6 in OKLab over saturated opaque logo pixels, snapped to nearest real pixel' }));

/* --- slide + cover pixels (JPEG): decode in Chrome --- */
const { launch } = await import(pathToFileURL(join(ROOT, 'gates/lib/env.mjs')).href);
const browser = await launch();
const page = await browser.newPage();
await page.goto('about:blank');
const decode = async (file) => {
  const b64 = readFileSync(file).toString('base64');
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, data: Array.from(ctx.getImageData(0, 0, c.width, c.height).data) };
  }, 'data:image/jpeg;base64,' + b64);
};
const slideName = 'ACCRUE 1.jpg.jpeg';
const coverName = readdirSync(REF).find((n) => /SAMPUL/i.test(n));
const slide = await decode(join(REF, slideName));
const cover = await decode(join(REF, coverName));
await browser.close();
const px = (im, x, y) => { const o = (y * im.w + x) * 4; return [im.data[o], im.data[o + 1], im.data[o + 2]]; };
const region = (im, x0, y0, x1, y1, keep) => {
  const out = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const rgb = px(im, x, y);
    const lab = toOklab(...rgb);
    if (keep(lab)) out.push({ x, y, rgb, lab });
  }
  return out;
};
const record = (token, file, p, method) => (report.samples[token] = { file, x: p.x, y: p.y, rgb: p.rgb, method });
const at = (im, x, y) => ({ x, y, rgb: px(im, x, y) });

const white = at(slide, 20, 20);
const grey = at(cover, 20, 20);
record('paper-raised', 'reference/' + slideName, white, 'real pixel, slide background');
record('paper', 'reference/' + coverName, grey, 'real pixel, cover background');
// wordmark: darkest pixel in the ACCRUE lettering
const wm = region(slide, 76, 38, 240, 62, () => true).reduce((m, p) => (p.lab[0] < m.lab[0] ? p : m));
record('ink', 'reference/' + slideName, wm, 'darkest pixel of the ACCRUE wordmark');
// slide headline blue: k-means k=1 over saturated headline pixels, snapped
const head = region(slide, 76, 245, 860, 390, (l) => Math.hypot(l[1], l[2]) > 0.09 && l[0] < 0.8);
const accent = kmeansSnap(head, 1)[0];
record('accent', 'reference/' + slideName, accent, 'k-means k=1 over headline pixels, snapped');
// slide body navy: darkest-cluster centroid
const body = region(slide, 76, 440, 680, 540, (l) => l[0] < 0.55);
const navy = kmeansSnap(body, 2).sort((a, b) => a.lab[0] - b.lab[0])[0];
record('navy', 'reference/' + slideName, navy, 'k-means k=2 over body text pixels, darker cluster, snapped');
// terminal black from the cover
const term = region(cover, 520, 400, 720, 470, (l) => l[0] < 0.3);
const night = kmeansSnap(term, 1)[0];
record('night', 'reference/' + coverName, night, 'k-means k=1 over terminal casing pixels, snapped');

/* --- write tokens.css --- */
const c = (rgb) => toOklch(...rgb);
const S = report.samples;
const base = (t) => c(S[t].rgb);
const ink = base('ink');
const navyC = base('navy');
const nightC = base('night');
const whiteC = base('paper-raised');
const accentC = base('accent');
const paperC = base('paper');
const sunk = { ...paperC, L: Math.max(0, paperC.L - 0.035) };
const nightRaised = { ...nightC, L: Math.min(1, nightC.L + 0.06) };
const B = (i) => oklchCss(c(S['brand-' + i].rgb));

const lines = [];
const prov = (t) => `${S[t].file} @ (${S[t].x}, ${S[t].y}) rgb(${S[t].rgb.join(' ')})`;
const css = `/*
  TOKENS — the only file in the project allowed to contain colour literals.
  Everything else references these custom properties (or reads them at runtime).
  WRITTEN BY tools/sample-brand.mjs. Do not edit by hand; re-run the tool.

  SAMPLED PALETTE (replaces the earlier achromatic placeholder). Provenance:
  Brand gradient --brand-1..6 (sorted by hue): k-means, k=6, in OKLab, over the saturated opaque pixels
    of brand/${logo.name} (every 5th pixel, farthest-point init, 30 iterations); each centroid is
    snapped to the nearest real pixel coordinate:
${brand.map((p, i) => `      --brand-${i + 1}  (${p.x}, ${p.y})  rgb(${p.rgb.join(' ')})  share ${(p.share * 100).toFixed(1)}%`).join('\n')}
  --paper-raised  ${prov('paper-raised')}
  --paper         ${prov('paper')}
  --ink           ${prov('ink')}  (darkest wordmark pixel)
  --accent        ${prov('accent')}  (k-means k=1 over headline pixels)
  --navy          ${prov('navy')}  (k-means k=2 over body text, darker cluster)
  --night         ${prov('night')}  (k-means k=1 over terminal casing)
  Everything else is DERIVED from those samples: same hue and chroma with a changed lightness
  (--paper-sunk, --night-raised) or the same colour with an alpha (hairlines, glass, shadows, skeletons).
  brand/${logo.name} carries ${logo.blackTransparent.toLocaleString('en-US')} pure-black fully transparent pixels,
  so every resize of it (favicon, nav logo) is done in premultiplied alpha.
*/
:root {
  --brand-1: ${B(1)};
  --brand-2: ${B(2)};
  --brand-3: ${B(3)};
  --brand-4: ${B(4)};
  --brand-5: ${B(5)};
  --brand-6: ${B(6)};
  --accent: ${oklchCss(accentC)};
  --navy: ${oklchCss(navyC)};

  --paper: ${oklchCss(paperC)};
  --paper-raised: ${oklchCss(whiteC)};
  --paper-sunk: ${oklchCss(sunk)};
  --ink: ${oklchCss(ink)};
  --ink-strong: ${oklchCss(ink)};
  --ink-soft: ${oklchCss(navyC)};
  --ink-faint: ${oklchCss(navyC, 0.62)};
  --hairline: ${oklchCss(navyC, 0.12)};
  --hairline-strong: ${oklchCss(navyC, 0.24)};

  --night: ${oklchCss(nightC)};
  --night-raised: ${oklchCss(nightRaised)};
  --on-night: ${oklchCss(whiteC)};
  --on-night-soft: ${oklchCss(whiteC, 0.72)};
  --on-night-faint: ${oklchCss(whiteC, 0.44)};
  --night-hairline: ${oklchCss(whiteC, 0.22)};
  --night-glass: ${oklchCss(nightC, 0.5)};

  --dither-lo: var(--night);
  --dither-hi: var(--brand-3);

  --shadow-soft: ${oklchCss(navyC, 0.08)};
  --shadow-lift: ${oklchCss(navyC, 0.16)};
  --flash: ${oklchCss(accentC, 0.22)};
  --flash-night: ${oklchCss(whiteC, 0.28)};
  --skeleton-a: ${oklchCss(navyC, 0.07)};
  --skeleton-b: ${oklchCss(navyC, 0.16)};
  --skeleton-night-a: ${oklchCss(whiteC, 0.08)};
  --skeleton-night-b: ${oklchCss(whiteC, 0.22)};

  --warn: var(--brand-4);
  --focus: var(--ink);

  --preload-top: var(--night);
  --preload-bottom: var(--accent);
}
`;
writeFileSync(join(ROOT, 'src/tokens.css'), css);

/* --- icons: crop to the logo's alpha bounding box, square it, resize premultiplied --- */
let minx = L.w, miny = L.h, maxx = 0, maxy = 0;
for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) if (L.data[(y * L.w + x) * 4 + 3] > 8) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
const bw = maxx - minx + 1, bh = maxy - miny + 1;
const side = Math.ceil(Math.max(bw, bh) * 1.12);
const rect = { x: Math.round(minx + bw / 2 - side / 2), y: Math.round(miny + bh / 2 - side / 2), s: side };
mkdirSync(join(ROOT, 'public'), { recursive: true });
for (const [file, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180], ['logo-256.png', 256]]) writePng(join(ROOT, 'public', file), size, size, resizePremultiplied(L, rect, size));
copyFileSync(join(REF, coverName), join(ROOT, 'public/og.jpg'));
report.icons = { source: 'brand/' + logo.name, alphaBBox: { minx, miny, maxx, maxy }, cropSquare: rect, resize: 'premultiplied box filter', outputs: ['public/favicon-32.png', 'public/apple-touch-icon.png', 'public/logo-256.png'], ogImage: 'public/og.jpg <- reference/' + coverName };
writeFileSync(join(ROOT, 'tools/palette.sampled.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ files: report.files, brand: brand.map((p) => ({ x: p.x, y: p.y, rgb: p.rgb })), accent: accent.rgb, navy: navy.rgb, ink: wm.rgb, night: night.rgb, rect }, null, 1));
