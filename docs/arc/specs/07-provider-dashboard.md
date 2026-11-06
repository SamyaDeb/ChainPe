# Spec 07 — Personalised provider dashboard

**Goal:** a developer connects the wallet they registered with and sees **only their own** services,
revenue, buyers, ratings and health. Free vs Pro views follow `ChainPeAccounts.planOf`. This is the
business model surface. **Built in Arc Studio** (prompt: `../prompts/studio-02-dashboard.md`) and
pulled into `apps/arc-dashboard`.

## Stack (Studio sandbox = Vite)

Vite + React + TypeScript, `viem` (+ `wagmi` if Studio prefers), injected wallet (MetaMask/Rabby) with
"add Arc testnet" helper. No private keys in the browser. All data from `chainpe-cloud` (spec 08);
on-chain writes (subscribe) go through the user's wallet.

## Screens

| Screen | Free | Pro |
|---|---|---|
| **Sign in** | connect wallet → sign nonce → session; unregistered wallet sees "Register with `chainpe register`" + copyable command | same |
| **Overview** | revenue 24h / 7d (USDC), paid calls, success rate, unique buyers, rail split (exact vs Gateway), Gateway balance (from CLI heartbeat) | + 30d / 90d / all-time ranges, trend line |
| **Services** | each service: endpoint, price, rails, status dot (last heartbeat), doctor score, ERC-8004 agentId link | + per-route revenue and latency |
| **Payments** | last 7 days: time, route, rail, amount, payer (short), tx link to `explorer.testnet.arc.io`, self-pay badge | full history, filters, CSV export |
| **Buyers** | top 5 payer wallets | all, with first/last seen and spend |
| **Reputation** | average ERC-8004 score + count | every feedback, tag, trend |
| **Listing health** | last `chainpe doctor` result | continuous check history (every 15 min), alerts config |
| **Billing** | plan, `paidUntil`, Pro features list, **Upgrade** button: `USDC.approve(accounts, price*n)` then `ChainPeAccounts.subscribe(n)` | renew / extend |
| **Settings** | ingest keys (create/revoke), telemetry on/off note, wallets marked as "mine" (self-pay filter) | + alert channels |

Locked Pro widgets show a blurred preview + "Upgrade with USDC" (no fake numbers).

## Rules

- Every API call sends the session; the API scopes to the signed-in address. The UI never takes an address from the URL.
- Amounts: USDC with 6 decimals from API strings (`amountAtomic`), formatted to 6 dp under $0.01, else 2 dp.
- Self-pay (payer == payTo or in "my wallets") is shown but excluded from revenue totals.
- Explorer links per network: `https://explorer.arc.io/tx/<hash>` / `https://explorer.testnet.arc.io/tx/<hash>`.
- Empty states tell the next CLI command to run (`chainpe start`, `chainpe doctor`, `chainpe login`).
- Mobile: single column below 640 px; tables become cards.

## Config

`VITE_CHAINPE_CLOUD_URL`, `VITE_ARC_NETWORK` (`arc` | `arc-testnet`), `VITE_ACCOUNTS_ADDRESS`, `VITE_USDC_ADDRESS`.

## Acceptance

- [ ] Seller wallet sees its services and the demo payments within 5 s of a paid call.
- [ ] A different registered wallet sees only its own data; an unregistered wallet sees the register prompt.
- [ ] Free account cannot load payments older than 7 days (API enforced, not only UI).
- [ ] Upgrade flow on Arc testnet flips the plan badge to Pro after the tx.
- [ ] Studio workspace URL opens the same app (for judges).
