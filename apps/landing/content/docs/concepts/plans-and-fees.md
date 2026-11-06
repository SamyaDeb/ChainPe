---
title: Plans and fees
description: What's free, what Pro adds, and the planned usage fee.
---

The CLI, proxy and SDK are free and open source. Buyers pay your wallet directly, and ChainPe never holds your money.

## Plans

Register once with `chainpe register`, and sign in to the dashboard with that wallet.

| | Free | Pro |
|---|---|---|
| Price | 0 | 19 USDC per 30 days, paid on Arc. 1 USDC on testnet |
| Services | 1 | Up to 10 |
| Revenue and calls | Last 7 days | Full history |
| Breakdown | Total only | By route, rail and buyer wallet |
| Ratings | Average score | Every review, trend and tag |
| Export | None | CSV of payments |

```bash
chainpe plan      # shows your plan
chainpe upgrade   # pays for Pro in USDC
```

Your plan is read from `ChainPeAccounts` on Arc, with no separate billing system. When Pro runs out you return to Free. Your data is kept, and your active services stay active. Only new registrations and reactivations are limited.

## Usage fee

**Planned, not live.** The fee contract is not deployed, so nothing is charged today.

The plan is 1% of verified revenue, or 0.5% on Pro. Circle only settles to a wallet the seller signs for, so buyers will still pay you directly. The fee will be collected afterwards, in batches, from USDC you approve and can revoke.
