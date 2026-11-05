# Spec 08 — `chainpe-cloud` API

**Goal:** backend for registered providers: wallet auth, ingest from proxies, Arc indexing, and
scoped read APIs for the dashboard. Start from `services/chainpe-indexer` (Node, Drizzle, Postgres)
— copy to `services/chainpe-cloud`, keep the old indexer for Avalanche.

## Auth

| Endpoint | Body | Result |
|---|---|---|
| `POST /v1/auth/nonce` | `{ address }` | `{ nonce, message }` — message: `chainpe.app wants you to sign in with <address>\nNonce: <nonce>\nIssued At: <iso>\nChain ID: <id>` |
| `POST /v1/auth/verify` | `{ address, signature }` | verifies with viem `verifyMessage`; requires `ChainPeAccounts.providers(address).exists`; returns httpOnly session cookie (JWT, 7 days, `SESSION_SECRET`) |
| `POST /v1/auth/logout` | — | clears session |
| `POST /v1/keys` | session | new ingest key `cpk_<random>`; stored as SHA-256 hash; shown once |
| `GET /v1/keys`, `DELETE /v1/keys/:id` | session | list / revoke |

`chainpe login` = nonce → sign with seller key locally → verify → create key → save to `~/.chainpe/config.json`.

## Ingest (from CLI proxies)

| Endpoint | Auth | Body |
|---|---|---|
| `POST /v1/ingest/events` | `Bearer cpk_…` | `{ events: PaymentEvent[] }` (spec 04), ≤ 500 per call, idempotent on `id` |
| `POST /v1/ingest/heartbeat` | `Bearer cpk_…` | `{ serviceKey, version, network, rails, gatewayBalanceAtomic, doctor?: DoctorJson }` |

Events for a `payTo` the key's provider doesn't own are rejected (403).

## Arc indexer (worker in the same service)

Poll every 3 s with `getLogs` from `indexer_state.last_block` (Arc finality < 1 s, so no confirmation depth):

| Source | Event | Stored as |
|---|---|---|
| USDC `0x3600…0000` | `Transfer(from, to, value)` where `to` ∈ registered payTo set | `onchain_transfers` (source of truth for exact revenue) |
| `ChainPeAccounts` | Provider/Service/Subscribed events | `providers`, `services`, `subscriptions` |
| ERC-8004 ReputationRegistry | `NewFeedback` for agentIds of registered providers | `feedback` |

Reconcile: an ingest event with `txHash` matching an `onchain_transfers` row is marked `verified`.
Exact revenue shown = verified on-chain transfers; Gateway revenue = ingest events (Gateway settles in batches).

## Read API (session-scoped; plan enforced server-side)

| Endpoint | Returns | Free limit |
|---|---|---|
| `GET /v1/me` | address, agentId, plan, paidUntil | — |
| `GET /v1/me/services` | services + last heartbeat + doctor score | 1 service |
| `GET /v1/me/summary?range=24h\|7d\|30d\|90d\|all` | revenue (exact/gateway), calls, success rate, unique buyers, series | 24h, 7d only |
| `GET /v1/me/payments?cursor=&rail=&route=` | paginated events | last 7 days |
| `GET /v1/me/payments.csv` | CSV | Pro only |
| `GET /v1/me/buyers` | payers with spend | top 5 |
| `GET /v1/me/reputation` | feedback list + average | average only |
| `GET /v1/me/health` | doctor history | latest only |
| `PUT /v1/me/wallets` | "my wallets" for self-pay filter | — |

Plan = `planOf(address)` read on Arc, cached 60 s.

## Tables (Drizzle)

`providers(address pk, agent_id, created_at, paid_until)` · `services(key pk, provider, name, endpoint, price, network, pay_to, rails, active)` ·
`ingest_keys(id, provider, hash, created_at, revoked_at)` · `payment_events(id pk, provider, service_key, ts, route, rail, network, amount_atomic, payer, pay_to, tx_hash, payment_id, status, latency_ms, verified)` ·
`onchain_transfers(tx_hash, log_index, block, from, to, amount_atomic, ts)` · `feedback(...)` (reuse existing) ·
`heartbeats(service_key, ts, version, gateway_balance_atomic, doctor_json)` · `subscriptions(provider, periods, amount, paid_until, tx_hash)` ·
`my_wallets(provider, address)` · `indexer_state(id, last_block)`.

## Stretch: alerts (Pro)

Worker checks every minute: settlement failures > 3 in 10 min, no heartbeat for 10 min, new feedback < 50.
Channels: email (Resend) or Telegram bot token per provider.

## Deploy

Railway: one service + Postgres. Env: `DATABASE_URL`, `SESSION_SECRET`, `ARC_NETWORK`, `ARC_RPC_URL`,
`CHAINPE_ACCOUNTS_ADDRESS`, `ERC8004_REPUTATION_REGISTRY`, `CORS_ORIGIN` (dashboard URL).

## Acceptance

- [ ] Sign-in fails for an unregistered address (403 `not_registered`).
- [ ] Paid call → event visible in `/v1/me/payments` < 5 s; matching on-chain transfer marks it `verified`.
- [ ] Wallet A's session cannot read wallet B's data (test).
- [ ] Free plan: `range=30d` → 402-style `plan_required` error; Pro passes.
