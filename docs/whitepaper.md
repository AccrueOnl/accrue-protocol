# Accrue Whitepaper

*Version 0.1, design draft. Parameters marked **unconfirmed** have not been published.*

## 1. Summary

Most ways of paying with digital dollars consume the dollars themselves. Holding them safely and using them are the same pool, so every purchase shrinks the thing you were trying to protect.

Accrue separates the two. A holder funds the system with dollar-pegged coins. Those coins become a **base amount** that is routed to a single borrowing venue on Robinhood Chain. The returns that venue produces are recorded in a second counter, the **grown portion**. A payment card authorises purchases against the grown portion and nothing else. The base amount can leave the system only through a deliberate exit that the holder instructs.

The outcome is a simple promise with a hard edge: you can use what your funds have grown without ever drawing down the funds.

## 2. Problem

1. **Idle balances.** Dollars kept for safety earn nothing while they wait.
2. **Blurred accounting.** When growth and capital share one balance, a purchase cannot tell which one it is spending.
3. **Soft limits.** Systems that promise "spend only returns" often enforce it in application code, where a bug or a timeout can quietly widen the limit.

## 3. Design

### 3.1 Two counters

For each holder the ledger keeps two non-negative integers, both denominated in the funded coin:

- `base` - the amount the holder placed in the system and has not exited.
- `grown` - returns credited so far minus returns already consumed by purchases.

They are stored and updated separately. No operation moves value from `base` to `grown`, and no operation lets a purchase read `base`.

### 3.2 Invariants

| # | Invariant |
| --- | --- |
| I1 | A purchase of amount `p` is authorised only if `p <= grown`. |
| I2 | After an authorised purchase, `grown` falls by exactly `p`; `base` is unchanged. |
| I3 | If the grown portion cannot be read or computed, it is treated as zero and the purchase is declined. |
| I4 | `base` decreases only through an exit instructed by the holder's own signature. |
| I5 | A purchase larger than `grown` is declined in full. No partial fill, no top-up from `base`. |

I3 is the important one. The system fails closed: uncertainty reduces what can be used, never what is protected.

### 3.3 Where returns come from

Returns are ordinary borrower fees paid by participants of one money market on Robinhood Chain. There is no leverage, no recursive lending, and no strategy layer. The venue is named in the register once confirmed (**unconfirmed**).

Because borrowing demand moves, so do returns. Every figure the project shows is a reading, not a forecast.

### 3.4 Accrual

Returns are attributed per block. Let `s_t` be the venue's share price for the funded coin at block `t`. The base amount held as venue shares `n` grows in value as `n * s_t`. The grown portion at block `t` is

```
grown_t = max(0, n * s_t - base) - consumed_t
```

where `consumed_t` is the total already used for purchases. Taking the maximum with zero means a share price dip can never create a negative grown portion or a claim on `base`.

### 3.5 Authorisation

A purchase request carries an amount and a merchant reference. The authoriser reads `grown_t` from chain state, compares it to the request, and answers approve or decline. If the read exceeds its time budget the answer is decline (I3). Approved amounts are recorded as `consumed` before settlement so that two concurrent purchases cannot both spend the same growth.

### 3.6 Exit

The holder signs an exit for a chosen portion of `base`. Shares are redeemed from the venue and the coin is sent to the holder's own address. Exit is independent of the card: a card freeze, a dispute or an outage in the payments side cannot prevent it.

## 4. Threats considered

- **Venue loss.** If the borrowing venue loses funds, `base` can be impaired. This is a real risk of the design, not an edge case. Mitigation is disclosure and, later, venue limits and monitoring.
- **Oracle or read failure.** Handled by I3.
- **Race conditions at the point of sale.** Handled by recording consumption before settlement.
- **Key compromise.** Exit needs the holder's signature; the card cannot trigger it.
- **Front-end misstatement.** The site shows only readings it can verify and labels failures plainly.

## 5. What is not claimed

No rate, no yield figure, no audit result and no launch date is stated here. The contract address is not yet announced. When any of these exist they will be recorded in the project register first and quoted here second.

## 6. References

- Architecture notes: [architecture.md](architecture.md)
- Token considerations: [tokenomics.md](tokenomics.md)
- Delivery order: [roadmap.md](roadmap.md)
