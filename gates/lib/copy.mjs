import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/* Function words that cannot reasonably be avoided; every other shared word is a failure. */
export const STOP = new Set(
  'a an the and or but nor so yet of to in on at by for from with without into onto over under about as is are was were be been being am do does did have has had it its this that these those there here then than too very can could should would will may might must not no if when while where which who what why how all any both some such other you your we our they them their i me my he she his her up down out off'.split(' ')
);
/* Proper nouns, the chain facts the owner stated, and the brand itself. */
export const ALLOW = new Set(['accrue', 'robinhood', 'chain', 'evm', 'defillama', 'dexscreener', 'onl', 'ca', 'x', 'github', '4663']);

export const tok = (s) => s.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9$]+/).filter(Boolean);

/** Text a visitor can meet in the built markup: text nodes plus aria-label / title / meta content. */
export function markupText(html) {
  const bits = [];
  for (const m of html.matchAll(/(?:aria-label|title|content|alt)="([^"]+)"/g)) bits.push(m[1]);
  const t = (html.match(/<title>([^<]*)/) || [])[1];
  if (t) bits.push(t);
  bits.push(...html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').split(/<[^>]*>/));
  return bits.filter((b) => /[a-z]/i.test(b));
}

/** Multi-word string literals from the scripts: the copy that only appears at runtime. */
export function scriptText(libDir) {
  const out = [];
  for (const f of readdirSync(libDir)) {
    const t = readFileSync(join(libDir, f), 'utf8');
    for (const m of t.matchAll(/'([^'\n]{4,})'/g)) if (!m[1].startsWith('<') && /[A-Za-z]{3,} [A-Za-z]{2,}/.test(m[1])) out.push(m[1]);
  }
  return out;
}

export function compareCopy(blocks, ref) {
  const refWords = new Set(ref.words);
  const refBi = new Set(ref.bigrams);
  const words = new Set();
  const bigrams = new Set();
  for (const block of blocks.join('\n').split(/\n+/)) {
    const t = tok(block);
    t.forEach((w) => words.add(w));
    for (let i = 0; i < t.length - 1; i++) bigrams.add(t[i] + ' ' + t[i + 1]);
  }
  const sharedWords = [...words].filter((w) => refWords.has(w) && !STOP.has(w) && !ALLOW.has(w));
  const sharedBigrams = [...bigrams].filter((b) => {
    if (!refBi.has(b)) return false;
    const [x, y] = b.split(' ');
    // a preposition or article beside the chain name is unavoidable ("on Robinhood Chain"); every other pair must differ
    const named = (w) => ALLOW.has(w) || STOP.has(w);
    return !(named(x) && named(y) && (ALLOW.has(x) || ALLOW.has(y)));
  });
  return { sharedWords, sharedBigrams, nWords: words.size, nBigrams: bigrams.size };
}
