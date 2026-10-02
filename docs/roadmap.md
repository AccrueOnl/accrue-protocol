# Roadmap

*Version 0.1. Ordered by dependency, not by calendar. No dates are promised.*

The order below follows one rule: a stage opens only when the previous one has been exercised with trivial amounts and its checks pass.

## Stage 0 - Public meter (in progress)

- Public site on `accrue.onl` with live block height, gas price, chain value and active pairs from open sources
- Project register for every external fact; empty slots stay inert
- Automated gates for layout at five widths, motion, live-data failure handling and copy originality
- Brand palette and icons sampled from the real assets, with provenance

**Exit condition:** gates green; every shown figure traceable to a public source.

## Stage 1 - Ledger and accrual

- Two-counter ledger (base and grown) with the invariants from the whitepaper encoded as tests
- Share-price accrual per block against the single borrowing venue
- Read-only dashboard that reproduces a holder's counters from chain state alone

**Exit condition:** an independent reader can recompute any holder's grown portion and match it exactly.

## Stage 2 - Funding and exit

- Fund and exit flows with the smallest practical amounts
- Exit that works with the card side fully offline
- Fail-closed behaviour proven under read timeouts and venue pauses

**Exit condition:** exit succeeds in every simulated outage of the payments path.

## Stage 3 - Authorisation service

- Purchase authoriser that reads the grown portion, declines on uncertainty, and records consumption before settlement
- Concurrency tests: two simultaneous purchases never spend the same growth
- Decline reasons that the holder can understand

**Exit condition:** no test sequence can authorise more than `grown`.

## Stage 4 - Card pilot

- Small invited pilot with contactless checkout
- Real-world dispute, refund and reversal paths mapped onto the counters
- Public incident notes for anything that goes wrong

**Exit condition:** pilot cohort completes a full cycle (fund, grow, tap, exit) without manual correction.

## Stage 5 - Wider access

- Venue limits and monitoring
- Independent review of contracts and the authoriser, published in full
- Broader onboarding

**Exit condition:** published review with all high-severity findings resolved.

## Not on the roadmap

- Leverage, looping or any second source of returns
- A mechanism that lets a purchase reach the base amount, even as an opt-in
- Statements of a fixed rate

## How to follow progress

Progress is recorded in the repository history and in the project register. A stage is not "done" until its exit condition is demonstrated and written down.
