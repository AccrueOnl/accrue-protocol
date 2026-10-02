# Security Policy

## Scope

This repository currently contains the public site and its tooling. Smart contracts, the authoriser service and the card programme are **planned** and not yet in scope for live funds. This policy still applies to anything that could mislead a visitor or leak data.

In scope today:

- the site served at `accrue.onl` and its build
- the contract-address slot and social links (for example, a way to make a false address or link appear)
- the live-data readers (for example, injection through third-party responses)
- the build and gate tooling in this repository

Out of scope:

- third-party services the site reads (the RPC endpoint, DefiLlama, DexScreener)
- social engineering and physical attacks
- findings that need a compromised visitor device

## How to report

Do not open a public issue for a vulnerability.

A dedicated security contact has not been announced yet. Until one is published on `accrue.onl`, use the private vulnerability reporting feature of the code host once the repository is public, and include:

- what you found and where
- steps to reproduce, ideally with a minimal page or request
- the impact as you understand it
- whether you intend to disclose, and when

If no private channel is available when you read this, wait: the policy will be updated before any live-funds component ships.

## What to expect

| Step | Target |
| --- | --- |
| Acknowledge receipt | within 3 working days |
| First assessment | within 10 working days |
| Fix or mitigation plan | communicated as soon as it is understood |
| Public note | after a fix ships, crediting you if you wish |

These are targets for a small team, not contractual guarantees.

## Safe-harbour intent

Good-faith research that avoids privacy violations, data destruction and service disruption will not be treated as hostile. Please do not test against real wallets or real funds, and do not run automated scans that degrade the site for others.

## Design stance

The project fails closed. If a reading cannot be verified, the site shows it as unavailable rather than guessing, and the protocol design treats an unreadable grown portion as zero. Reports that show a path where the opposite happens are especially valuable.

## Known limits

- Returns depend on a single borrowing venue; loss at that venue can impair the base amount. This is documented in the whitepaper as an inherent risk, not a vulnerability.
- The site shows readings from public sources and may lag or fail; it never presents a reading as a promise.
