# Business model — registration + personalised dashboard

ChainPe makes money from the **developers who register**, not from their payments.
The CLI, proxy and SDK stay free and open source; registered providers get a personalised
dashboard, and the deeper analytics sit behind a paid Pro plan.

## Why not a cut of payments

Circle's Facilitator Service requires a signature from the seller's own `payTo` key on every
settle call (`Facilitator-Seller-Proof`). Payments go straight from buyer to the developer's
wallet; ChainPe never touches the money. That is a selling point ("non-custodial, no take rate"),
and it rules out a percentage fee.

## Who registers and what they get

Registration = an on-chain provider account on `ChainPeAccounts` (Arc) linked to the payout wallet,
plus an ERC-8004 identity. Signing in with that wallet unlocks *their* dashboard: only their services,
their buyers, their revenue.

| | Free | Pro |
|---|---|---|
| Price | 0 | **19 USDC / 30 days** on mainnet (default, owner to confirm), paid on Arc. Testnet: 1 USDC, because the faucet gives 20 USDC per 2 hours |
| Services | 1 | up to 10 |
| Revenue + calls | last 7 days | full history |
| Breakdown | total only | by route, by rail (exact / Gateway), by buyer wallet |
| Ratings (ERC-8004) | average score | every review, trend, tag |
| Listing health | manual `chainpe doctor` | continuous checks every 15 min + history |
| Alerts | — | settlement failures, endpoint down, rating drop (email / Telegram) |
| Export | — | CSV of payments for accounting |
| Self-pay filter | ✓ | ✓ |

How the plan is enforced:

- `ChainPeAccounts.subscribe(PLAN_PRO, months)` pulls USDC from the developer into the ChainPe treasury
  and extends `paidUntil`.
- `chainpe-cloud` reads `planOf(provider)` on Arc on each dashboard session; no off-chain billing system.
- Downgrade is automatic when `paidUntil` passes; data is kept, the extra views lock.

## Revenue math (illustrative)

| Providers | Pro conversion | MRR (USDC) |
|---|---|---|
| 100 | 10% | 190 |
| 1,000 | 8% | 1,520 |
| 10,000 | 5% | 9,500 |

## Later options (not in hackathon scope)

- Team plan: multiple wallets per account, roles.
- Hosted proxy (no server for the developer to run): usage-priced.
- Verified badge after N days of passing health checks, shown in discovery metadata.

## How to pitch it

"Developers keep 100% of what agents pay them. They pay us for the dashboard that tells them who
is paying, what is breaking, and how to get found — billed in USDC on Arc."
