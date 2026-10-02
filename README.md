# Accrue

**Growth that picks up the tab.** Accrue is an on-chain accumulation protocol and payment card on Robinhood Chain (chain id 4663, site: [accrue.onl](https://accrue.onl)). Dollar-pegged coins go in and sit as a **base amount**. Returns from a single borrowing venue build up block by block in a separate counter. Checkout draws on that counter alone. The base amount is never reachable by a purchase.

> Status: pre-launch. The contract address, social profiles and launch date are not announced. Nothing in this repository should be read as a promise of returns.

## The idea in four lines

1. **Fund** - move dollar-pegged coins in; they become the base amount.
2. **Grow** - returns accumulate per block, tracked apart from the base.
3. **Tap** - a purchase can only consume the grown portion; anything larger is declined whole.
4. **Exit** - the base amount returns to your own address when you instruct it, and only then.

## Repository map

| Path | What lives there |
| --- | --- |
| `index.html`, `src/` | The public site (Vite, no framework) |
| `src/registry.js` | One record per external fact, each `stated`, `absent` or `unconfirmed` |
| `src/tokens.css` | The only file allowed to hold colour literals; generated from the brand sampler |
| `tools/sample-brand.mjs` | Samples `brand/` and `reference/`, writes the palette, icons and provenance |
| `gates/` | Automated checks: layout at five widths, motion, live data, copy originality |
| `docs/` | Whitepaper, tokenomics, roadmap and architecture notes |
| `brand/`, `reference/` | Logo files and presentation slides (source material) |

## Develop

```bash
npm install
npm run dev        # local site
npm run build      # production bundle in dist/
npm run gates      # full check suite (about a minute)
```

Requires Node 20 or newer and a Chromium-family browser for the gates.

## Live readings

The site reads three public sources and shows nothing it cannot verify:

- block height and gas price from the Robinhood Chain RPC
- chain value from DefiLlama
- active pairs from DexScreener

Every reading has a skeleton while loading and an explicit "Unavailable" state on failure. A failed read is never rendered as zero.

## House rules

- **Register first.** A fact that is not in `src/registry.js` as `stated` does not appear on the site.
- **No href without a stated record.** Links derive from stored URLs; handles are derived, never typed twice.
- **Colours live in one file.** Anything else referencing a literal fails the gates.
- **Motion obeys the system setting.** With reduced motion on, everything is instant.

## Contributing and security

See [CONTRIBUTING](.github/CONTRIBUTING.md) and [SECURITY](.github/SECURITY.md). Licensed under the terms in [LICENSE](LICENSE).
