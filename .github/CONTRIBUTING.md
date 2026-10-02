# Contributing to Accrue

Thanks for helping. This project is small and strict on purpose. Read this before opening a change.

## Ground rules

1. **Facts go through the register.** An address, a profile, a date or a rate appears on the site only if `src/registry.js` records it as `stated`. If you find a fact missing, add it as `absent` or `unconfirmed` and say where it came from.
2. **No invented numbers.** Do not add rates, supply figures, audit claims or dates that the owner has not stated.
3. **Links derive from URLs.** Store the URL, derive the handle. A record that is not `stated` must not produce an `href`.
4. **Colours live in `src/tokens.css`.** It is written by `tools/sample-brand.mjs`; re-run the tool instead of editing it by hand. No colour literal may appear anywhere else.
5. **Original words.** Site copy must be your own; it is checked against a vocabulary fixture for shared words and two-word phrases.
6. **Motion is optional.** Everything that animates must have an instant fallback under reduced motion.

## Setup

```bash
npm install
npm run dev
```

## Before you push

```bash
npm run build
npm run gates
```

Both must exit 0. The gates run in about a minute and cover:

- layout at 360, 390, 430, 1366 and 1440 pixels (no overflow, 48 px tap targets, no `ch` units)
- the contract slot (inert while absent, full address and click-to-copy when stated)
- live-data behaviour (skeletons, count-up, flash, failure states) against synthetic fixtures only
- reduced-motion behaviour, hover and focus states, scroll progress, reveals and parallax
- palette provenance, copy originality and repository hygiene

Do not point gates at real endpoints or real addresses. Fixtures are synthetic by design.

## Pull requests

- Keep each change focused; explain the user-visible effect in the first lines.
- Include before and after screenshots for visual changes at one narrow and one wide width.
- If you add a gate, keep the total at or under 30 and the suite under five minutes.
- Do not commit build output, `node_modules` or editor configuration.

## Reporting problems

Bugs and rough edges are welcome as issues. For anything that could put funds or personal data at risk, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Code style

Plain modern JavaScript modules, no framework. Match the surrounding code: comment density, naming and idiom. Prefer clear failure states over silent fallbacks.
