import { rmSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { serve, launch, FX } from './lib/env.mjs';
import { ROOT, staticGates, loadModules, walk } from './static.mjs';
import { browserGates } from './browser.mjs';

const BUDGET_MS = 5 * 60 * 1000;
const started = Date.now();
const GATE_DIR = join(ROOT, '.gate');

async function buildTo(name, fixture) {
  process.env.ACCRUE_REGISTER_FIXTURE = fixture ? '1' : '0';
  const outDir = join(GATE_DIR, name);
  await build({ root: ROOT, logLevel: 'silent', configFile: join(ROOT, 'vite.config.js'), build: { outDir, emptyOutDir: true } });
  return outDir;
}

/* npm run build output is reused when it is newer than every source file; otherwise gates build their own copy. */
function freshDist() {
  const dist = join(ROOT, 'dist');
  if (!existsSync(join(dist, 'index.html'))) return null;
  const built = statSync(join(dist, 'index.html')).mtimeMs;
  const sources = [join(ROOT, 'index.html'), join(ROOT, 'vite.config.js'), ...walk(join(ROOT, 'src'))];
  return sources.every((f) => statSync(f).mtimeMs <= built) ? dist : null;
}

rmSync(GATE_DIR, { recursive: true, force: true });
mkdirSync(GATE_DIR, { recursive: true });

const mods = await loadModules();
const ctx = { root: ROOT, ...mods, FX, builds: {}, servers: {}, pages: {}, corpus: [], errors: [], origins: new Set() };
ctx.builds.default = freshDist() || (await buildTo('default', false));
ctx.builds.stated = await buildTo('stated', true);
process.env.ACCRUE_REGISTER_FIXTURE = '0';
ctx.servers.default = await serve(ctx.builds.default);
ctx.servers.stated = await serve(ctx.builds.stated);

let browser = null;
const results = [];
const gates = [...staticGates, ...browserGates];
if (gates.length > 30) {
  console.error(`GATE COUNT ${gates.length} exceeds the cap of 30`);
  process.exit(2);
}

for (const g of gates) {
  const t0 = Date.now();
  const needsBrowser = browserGates.includes(g);
  try {
    if (needsBrowser && !browser) browser = ctx.browser = await launch();
    const note = await Promise.race([
      g.run(ctx),
      new Promise((_, rej) => setTimeout(() => rej(new Error('gate timed out after 100s')), 100000)),
    ]);
    results.push({ name: g.name, pass: true, ms: Date.now() - t0, note });
  } catch (e) {
    results.push({ name: g.name, pass: false, ms: Date.now() - t0, note: e.message });
  }
  const r = results[results.length - 1];
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${String(results.length).padStart(2, '0')} ${r.name} (${(r.ms / 1000).toFixed(1)}s)${r.pass ? '  ' + r.note : '\n      ' + r.note.replace(/\n/g, '\n      ')}`);
}

const total = Date.now() - started;
const budgetOk = total < BUDGET_MS;
console.log(`${budgetOk ? 'PASS' : 'FAIL'}  ${String(results.length + 1).padStart(2, '0')} time-budget (${(total / 1000).toFixed(1)}s of ${BUDGET_MS / 1000}s)`);
results.push({ name: 'time-budget', pass: budgetOk });

const settle = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 8000))]);
for (const h of Object.values(ctx.pages)) await settle(h.context.close().catch(() => {}));
if (browser) await settle(browser.close().catch(() => {}));
ctx.servers.default.close();
ctx.servers.stated.close();
rmSync(GATE_DIR, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} gates passed${failed.length ? ' — failing: ' + failed.map((f) => f.name).join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
