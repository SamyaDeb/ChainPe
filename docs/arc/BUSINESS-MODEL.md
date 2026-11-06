# Business model — registration + personalised dashboard

ChainPe makes money from the **developers who register**: a usage fee on verified revenue, and a paid Pro plan.
The CLI, proxy and SDK stay free and open source.

## The usage fee

**Status: opt-in on Arc testnet.** `ChainPeFees` is deployed at `0x09c85EEdeF018274861aae0964f9681C11f91Af4`. Only a provider who approves an allowance in Billing is charged.

ChainPe charges **1% of verified revenue, or 0.5% on Pro**, to providers who opt in. Rules and limits: [spec 12](specs/12-usage-fees.md).

Circle's Facilitator Service requires a signature from the seller's own `payTo` key on every settle call
(`Facilitator-Seller-Proof`), and the buyer signs one transfer to one address. So payments still go straight from
buyer to the developer's wallet, and the fee cannot be taken at that moment. It is collected afterwards, in batches,
from a USDC allowance the developer approves and can revoke. ChainPe never holds the developer's money.

The proxy is open source, so a developer can fork it or turn telemetry off and pay nothing. They give up verified
revenue and the dashboard. The fee is the price of those, and cannot be enforced on-chain.

## Who registers and what they get

Registration = an on-chain provider account on `ChainPeAccounts` (Arc) linked to the payout wallet,
plus an ERC-8004 identity. Signing in with that wallet unlocks *their* dashboard: only their services,
their buyers, their revenue.

| | Free | Pro |
|---|---|---|
| Price | 0 | **19 USDC / 30 days** on mainnet (default, owner to confirm), paid on Arc. Testnet: 1 USDC, because the faucet gives 20 USDC per 2 hours |
| Usage fee | 1% of verified revenue | 0.5% of verified revenue |
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

"Agents pay developers directly, in USDC on Arc. We take 1% of the revenue we can verify, and show developers who is
paying, what is breaking, and how to get found."
