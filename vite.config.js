import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const fixture = process.env.ACCRUE_REGISTER_FIXTURE === '1';

/* Read an oklch token from tokens.css and return an sRGB hex (used only in build output). */
function tokenHex(token) {
  const css = readFileSync(here('./src/tokens.css'), 'utf8');
  const m = css.match(new RegExp(String.raw`--${token}:\s*oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)`));
  if (!m) throw new Error('token --' + token + ' is missing from tokens.css');
  const L = parseFloat(m[1]);
  const C = parseFloat(m[2]);
  const h = (parseFloat(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const mm = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const ss = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * ss];
  const enc = (v) => {
    v = Math.min(1, Math.max(0, v));
    return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255).toString(16).padStart(2, '0');
  };
  return '#' + lin.map(enc).join('');
}

function tokenDerived() {
  return {
    name: 'accrue-token-derived',
    transformIndexHtml(html) {
      return html.replace('%THEME_COLOR%', tokenHex('night'));
    },
  };
}

export default defineConfig({
  plugins: [tokenDerived()],
  resolve: {
    alias: {
      '@register': here(fixture ? './gates/fixtures/registry.stated.js' : './src/registry.js'),
    },
  },
  build: { target: 'es2022', cssCodeSplit: false, assetsInlineLimit: 0 },
});
