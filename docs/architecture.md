# Architecture

*Version 0.1, design intent. Components marked **planned** are not built yet. The public site is the only shipped component.*

## 1. Overview

```
 holder wallet ──fund / exit──▶  Ledger contract  ──shares──▶  Venue adapter ──▶ borrowing venue
                                     │   ▲                         (Robinhood Chain)
                              counters   │ reads
                                     ▼   │
 card network ◀── approve/decline ── Authoriser ◀── Indexer (block-grain state)
                                     │
                                     ▼
                                Settlement log

 public site ◀── block, gas ── RPC ─┐
             ◀── chain value ── DefiLlama
             ◀── pairs ───────── DexScreener
```

## 2. Shipped: public site

A static Vite build with no framework and no runtime server.

| Concern | Choice |
| --- | --- |
| Facts | `src/registry.js`, one record per fact, state `stated`, `absent` or `unconfirmed` |
| Links | Stored as URLs; handles derived; no `href` for unstated records |
| Colour | `src/tokens.css` only, written by `tools/sample-brand.mjs` from the real assets |
| Live data | `src/lib/live.js`: RPC batch every 6 s, chain value and pairs every 60 s, sooner retry after a failure |
| Failure | Skeleton while loading, then either a value or "Unavailable". Never zero, never `NaN` |
| Motion | Reveals, count-up, flash on change, progress bar, parallax; all instant under reduced motion |

### Data flow on the site

1. Page loads, every live slot shows a skeleton and `aria-busy`.
2. Three readers start in parallel with an 8 s abort.
3. Each success writes through `setNumber` (count-up on first value, tween and flash on change).
4. Each failure writes "Unavailable" only if no earlier value exists, and schedules a retry.
5. The status pill reports `live`, `degraded` or `offline` from the combined result.

## 3. Planned: ledger contract

Holds, per holder, `base` and `consumed`, plus the venue shares that back them.

- `fund(amount)` mints venue shares and increases `base`.
- `exit(amount)` requires the holder's signature, redeems shares and decreases `base`.
- `consume(holder, amount)` callable only by the authoriser role; reverts if `amount > grown(holder)`.
- No function reads `base` on behalf of `consume`.

`grown(holder) = max(0, shares * sharePrice - base) - consumed`. The max with zero is deliberate (see the whitepaper).

## 4. Planned: venue adapter

A thin, replaceable wrapper around the single borrowing venue. It exposes `deposit`, `redeem` and `sharePrice`, and nothing else. It has no ability to choose a different venue or add leverage; replacing the venue is a redeploy, not a configuration flip.

## 5. Planned: indexer

Follows blocks and materialises `grown(holder)` for the authoriser. Every number it produces must be reproducible from chain state alone; the public dashboard will offer the same recomputation to anyone.

## 6. Planned: authoriser

- Receives a purchase request from the card programme.
- Reads `grown(holder)`; on timeout or error treats it as zero.
- Calls `consume` before acknowledging approval, so concurrent requests cannot share growth.
- Emits a settlement record for reconciliation.

Decline is the default outcome for anything it cannot prove.

## 7. Trust boundaries

| Boundary | Who can cross it |
| --- | --- |
| Holder to `base` | Only the holder, by signature |
| Authoriser to `grown` | Only through `consume`, bounded by `grown` |
| Site to chain | Read-only |
| Venue to ledger | Only through the adapter |

## 8. Observability

- Block lag between the indexer and the chain head
- Authoriser decision latency and decline reasons
- Venue share price deltas and pause states
- Public status page driven by the same readers the site uses

## 9. Testing posture

Invariants I1 to I5 from the whitepaper are encoded as property tests. The site's gates already enforce its own invariants: no unstated link, no truncated address, no horizontal overflow at 360, 390, 430, 1366 and 1440 pixels, and no fabricated value when a source fails.
