# Spec 08a: `chainpe-cloud` design (F0)

**Status:** approved 2026-11-06, all six recommendations (D1-D6). Implemented in `services/chainpe-cloud`.

Where this differs from spec 08, this note wins.

Evidence is one of: **ran** (executed on 2026-11-06 against Arc testnet or Circle), **docs** (Arc docs MCP), **source**
(read in the repo or `node_modules`), or **unverified**.

## Decisions (approved as recommended)

| # | Question | Recommendation |
|---|---|---|
| D1 | Which USDC emitter is the exact-rail source of truth? The brief says `0x3600…0000` | **System emitter `0xffff…fffe` only.** See section 3 |
| D2 | One SIWE domain, or one each for the dashboard and the CLI? The brief has one | **Two.** A single domain lets a malicious `--cloud-url` phish a seller's CLI. See section 1 |
| D3 | HTTP status of `plan_required`? Spec 08 says "402-style" | **403.** An x402 client could treat a real 402 from our API as a payment request |
| D4 | Telemetry flushes every 5 s, but acceptance is "visible within 5 s", which a 5 s flush can miss | **Flush every 2 s** or at 50 events. Otherwise relax the acceptance to 10 s |
| D5 | Do Free accounts get the rail, route and buyer breakdown? `BUSINESS-MODEL.md` says "total only". Your F0.6 and spec 08 give Free a rail split, filters and top-5 buyers | **Follow F0.6** and correct `BUSINESS-MODEL.md`. The rail split shows Free users what is verified and what is pending |
| D6 | Where does the ingest key live on Railway? `login` saves to `~/.chainpe/config.json`, which a container does not have | **Add a secret variable `CHAINPE_INGEST_KEY`** next to `CHAINPE_CLOUD_URL`. You set it |

## 1. Auth

**Flow.** `POST /v1/auth/nonce { address, client: "dashboard" | "cli" }` builds the full EIP-4361 message with
`createSiweMessage` and stores `{ nonce, address, domain, uri, expiresAt }`. `POST /v1/auth/verify { message, signature }`
then runs these steps:

1. Parse the message, and consume the nonce with `DELETE … RETURNING`, so it is single-use even under concurrent requests. Any
   attempt burns it. TTL is 5 min.
2. Require the message's `address`, `domain`, `uri`, `chainId` (5042002) and `expirationTime` to match the stored row. An
   edited message therefore fails.
3. Call `publicClient.verifySiweMessage({ message, signature, domain, nonce, address })`, which also covers ERC-1271.
4. Live read of `ChainPeAccounts.providers(address).exists`. If false, 403 `not_registered`. No indexer lag can affect this.

An invalid signature is 401. An RPC failure is 503 `chain_unavailable`, never 401 or 403, so an outage cannot read as "not registered".

**Ran:** `verifySiweMessage` returned true for a throwaway EOA on Arc in 157 ms, false for a wrong domain, and `verifyMessage`
returned false for the wrong signer. **Unverified:** the ERC-1271 path. No smart account was available without spending funds.
It relies on viem's validator, and F3 covers it with a mocked client only.

**Two domains (D2).** The server issues the message, so a client signs what a server sends it. If the CLI signed a dashboard-domain
message, a malicious `--cloud-url` could relay a real challenge and walk away with the seller's session.

- `client: "dashboard"` uses `SIWE_DOMAIN`, the dashboard host. Wallets warn unless this matches the page origin.
- `client: "cli"` uses `SIWE_CLI_DOMAIN`, the API host.
- `chainpe login` refuses to sign unless the parsed message's domain equals the host of the `cloudUrl` it is talking to, and its
  address, chain and expiry are as expected. A relayed challenge then fails on the CLI, or fails on the server if the domain was changed.

## 2. Session transport

Bearer JWT, as you recommended: HS256 pinned on verify, 12 h, `sub` = checksummed address, `jti` random. Returned in the body and
sent as `Authorization`. `CORS_ORIGIN` is an exact allowlist, with no cookies and no `credentials: true`.

- **Gained:** works in Safari cross-site, and with no ambient credential there is no CSRF surface.
- **Given up:** the token is readable by JavaScript, so an XSS on the dashboard can steal it for up to 12 h, where an httpOnly cookie
  could not be read. Mitigation for Phase 6: `sessionStorage` rather than `localStorage`, a strict CSP, and on-chain strings
  rendered as text only (review L-2). The token cannot move funds, only read this provider's data and manage its ingest keys.
- **Logout:** a stateless token cannot be recalled, so `auth/logout` adds the `jti` to `revoked_sessions` until its expiry, and every
  request checks that table.
- A session can create ingest keys, so a stolen token can too. Keys stay listed and revocable, which makes this visible.

## 3. Revenue trust model

### Exact rail

**Index only the system emitter `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE` (D1).**

**Ran**, receipt of our real exact payment `0x11027eae…c6c9`, which is what your question asked about:

| Log | Emitter | Event | Value |
|---|---|---|---|
| 1 | `0x3600…0000` | `AuthorizationUsed` | |
| 2 | `0xffff…fffe` | `Transfer`, buyer to seller | `10000000000000000` (18 decimals) |
| 3 | `0x3600…0000` | `Transfer`, buyer to seller | `10000` (6 decimals) |

So native movements do emit Transfer logs from the system address, and one payment produces two Transfers. Indexing both double-counts.
**Docs** say to build history from the system emitter: "filtering on the ERC-20 address alone misses them"
(`integrate/infrastructure`). A log's `from` is the real sender, whereas `tx.from` is the relayer. This tx confirms that: `tx.from` is `0x0011…`,
and the log's `from` is the buyer.

Either emitter would catch an x402 payment. The system one is the documented single stream, and it also lets the unattributed inflow
figure (below) include native sends. **Conversion:** `value / 10^12` to reach 6-decimal atomic units. A remainder means the
transfer cannot equal any 6-decimal price, so it is stored with its raw value and never matches.

**The `Transfer` ABI needs the address check.** Anyone can emit a `Transfer` from their own contract, so the indexer filters on
`address`, and tests assert that a log from another emitter is ignored.

### Gateway rail

**Ran:** a batch receipt (`0xccffd62c…1ab6`) has one log, from `0x0077…19b9`, and no Transfer to the seller. **On-chain logs cannot verify
this rail.** Circle's record is the only source.

| Fact | Evidence |
|---|---|
| `GET /v1/x402/transfers?to=…` and `GET /v1/x402/transfers/{id}` are public, with no API key | ran |
| Fields: `id, status, token, sendingNetwork, recipientNetwork, fromAddress, toAddress, amount, nonce, txHash, createdAt, updatedAt` | ran |
| `status` requires `from`, `to` or `nonce`: `{"success":false,"message":"Invalid request: query.status: status requires at least one of from, to, or nonce to narrow the search"}` | ran |
| Paging uses `pageSize`, `pageAfter` and a `Link` header | source |
| The SDK's `searchTransfers` is unusable here: `GatewayClient` requires a `privateKey`, and this service must hold no key | source. **We call the REST API directly** |
| Whether a transfer can reach `failed` after settle. We have never seen one | **unverified**, so F3 tests it with a stubbed response |

### Verification rules

Proxy telemetry adds context only. Status is recomputed from the source record, never taken from the event.

| Rail | `verified` requires |
|---|---|
| exact | A stored transfer with the same `txHash`, `to` = provider, `amount` equal, `from` = `payer`, and not already claimed by another event |
| gateway | A Circle record with the same id, `toAddress` = provider, `amount` equal, `fromAddress` = `payer`, `token` USDC, network matching, status not `failed` |

- **One claim per transfer.** A unique index on `matched_transfer` stops two events counting one payment. Without it, a provider could
  inflate revenue by resending one `txHash` under new ids.
- **States:** `unverified`, `verified`, `failed`, plus a `verification_reason` such as `no_transfer_yet`, `amount_mismatch`,
  `payer_mismatch` or `already_claimed`. A mismatch stays `unverified`, per your rule.
- **Gateway can move from `verified` to `failed`** when Circle's record changes. This closes the Phase 2 gap: the event leaves revenue and shows as served but unpaid.
- **Gateway `verified` includes money that has not landed.** Its status can be `received`, `batched` or `confirmed` before
  `completed`. Summaries therefore split gateway revenue into `settledAtomic` and `pendingBatchAtomic`. Only `settled` is final.
- **Revenue and times come from the source.** Amounts are the transfer's, and reporting time is the block time or Circle's `createdAt`. A proxy's `ts` is used only until
  then, and is rejected if more than 5 min in the future. This stops backdating around the Free window.
- **Self-pay** (`payer` = provider or in `my_wallets`) is flagged and excluded. Status still shows.

**Unattributed inflow.** Transfers to a provider with no matching event, including faucet drips, Gateway withdrawals and all
payments made under `--no-telemetry`, are shown as a separate `unattributedInflowAtomic`. They are never counted as revenue.

**Limit to state on the dashboard:** `verified` proves that money from that payer reached the provider and matches a proxy report. It does
**not** prove an independent customer. A provider can pay itself from an undeclared second wallet. The self-pay filter only catches wallets the
provider declares. So verified revenue is reliable for a provider's own accounting, but not as a public proof of traction.

## 4. Indexer

**Ran on the public RPC:**

| Probe | Result |
|---|---|
| Max `getLogs` range | Refuses between 9,921 and 10,000 blocks: code `-32012`, `requested range too large` |
| Max `getLogs` results | 2,000: code `-32012`, `query exceeds max results 2000, retry with the range a-b` |
| Rate limit | HTTP 429, code `-32005`, `rate limit exceeded`, from the 4th `getLogs` in about 600 ms |
| Unfiltered system Transfers | 4,026 logs in 1,000 blocks, so a filter on `to` is required |
| `to` filter with 1,000 addresses | Works |
| Block rate | 1.97 blocks/s. About 44,000 blocks since the deploy block |
| `blockTimestamp` in `getLogs` | Present, so no `getBlock` per log. Used if present, with a `getBlock` fallback |

**Chunking.** Start at 2,000 blocks, the size Arc's docs recommend. Halve only on the two `-32012` refusals (floor 100) and double back up after success. A 429
never shrinks a chunk, since a smaller range would not help: it backs off exponentially to 60 s, like other errors. `getLogs` calls are spaced 400 ms apart, and catching up waits 1 s between chunks.

**viem drops `args` when it is given `events` (plural).** A filtered read must use `event`, or the node returns every Transfer on Arc. A local run against the real RPC found this, because the
simulated chain applied the filter anyway. A test now checks the actual `eth_getLogs` topics.

**One chunk, one transaction, in this order:**

1. `ChainPeAccounts` events, to update the provider set.
2. Reputation events.
3. System Transfers with `to` in the provider set.
4. Advance `indexer_state.last_block`.

Writes and the cursor commit together, so a restart resumes exactly and repeats nothing. Upserts key on `(tx_hash, log_index)`. Step 1
comes first so a provider's first payment is caught in the chunk that registered it.

**Depth.** Finality needs **0 extra confirmations**: Arc is deterministic, with no reorgs (**docs**, `integrate/infrastructure#no-reorg-indexing`), so there is no rollback code.
The tail still stays **2 blocks behind head, about 1 s**. This is a precaution, not a finality rule: behind a load balancer, a lagging node can answer
`getLogs` for a block it has not seen with a successful empty result, and advancing past that would lose logs for good. I have
not observed this on Arc.

**Receipt fallback.** An exact event still unmatched once the cursor has passed it, and at least 30 s old, triggers one `getTransactionReceipt`.
Matching system-emitter logs are upserted. This closes any gap from the above, and covers transfers made before the provider joined the set.

**Accounts events:** `ProviderRegistered`, `AgentIdUpdated`, `ServiceRegistered`, `ServiceUpdated`, `ServiceDeactivated`, `Subscribed`. `description` and `tags` are not
in the events, so `getService` is read on change. All on-chain strings are untrusted (L-2): prices are parsed defensively, and the API returns `endpointHttps` (null unless `https:`).

**Reputation. Ran:** the live implementation `0x16e0FA7f…dA34` matches `contracts/abis/erc8004/ReputationRegistry.json`, 24 of 24 event and function signatures.
Two consequences:

- `value` is `int128` with `valueDecimals`. The old indexer's `integer` column cannot hold it, so this uses `numeric`.
- Index `NewFeedback` and `FeedbackRevoked` for **all** agentIds, not only registered ones. Volume is low (0 in the last 4,000 blocks), and a provider who links an existing
  agentId later would otherwise lose its earlier feedback.

**Limit:** feedback from before block 70918643 is not indexed. No live `NewFeedback` has been seen yet, so Phase 7 is its first real test.

## 5. agentId staleness (L-1)

Feedback is stored by `agent_id`, not provider. On read, `ownerOf(agentId)` must equal the provider, cached 60 s.

| Result | Response |
|---|---|
| Owned | Reputation shown, `agentIdStatus: "owned"` |
| Not owner | No reputation, `agentIdStatus: "not_owner"` |
| No agentId | `agentIdStatus: "none"` |
| RPC failure, no fresh cache | No reputation, `agentIdStatus: "unknown"`. Never shown as "no ratings" |

`Service.agentId` is a snapshot and is ignored here. Only `providers(addr).agentId` counts.

## 6. Plan gating

`planOf(address)` cached 60 s, and invalidated when the indexer sees `Subscribed`. On RPC failure, it falls back to the indexed `paid_until` compared with now, so an
outage does not downgrade a paying provider.

| | Free | Pro |
|---|---|---|
| `summary` range | `24h`, `7d` | also `30d`, `90d`, `all` |
| `payments` | last 7 days | all |
| `payments.csv` | `plan_required` | yes |
| `services` | 1 (oldest active) | all |
| `buyers` | top 5 | all |
| `reputation` | average only | every review |
| `health` | latest only | history |

Errors are `{ error: "plan_required", message }` with HTTP 403 (D3). Data is kept across a downgrade, and only the views lock.

## 7. Data model

Drizzle with `drizzle-kit` migrations committed and applied at boot. This replaces the old DDL-on-boot string.

Amounts are `numeric(78,0)`, which `pg` returns as strings, and are bigint or strings in code. `SUM` stays in SQL. A test greps for `Number(` on money fields. Addresses are stored lowercase and
returned checksummed.

| Table | Key | Columns |
|---|---|---|
| `providers` | `address` | `agent_id`, `created_at`, `paid_until`, `registered_block` |
| `services` | `key` | `provider`, `name`, `description`, `tags`, `endpoint`, `price`, `network`, `pay_to`, `accepts_exact`, `accepts_gateway`, `active`, `updated_block` |
| `subscriptions` | `(tx_hash, log_index)` | `provider`, `periods`, `amount_atomic`, `paid_until`, `block` |
| `siwe_nonces` | `nonce` | `address`, `domain`, `uri`, `expires_at` |
| `revoked_sessions` | `jti` | `expires_at` |
| `ingest_keys` | `id` | `provider`, `key_hash` (SHA-256, unique), `prefix` (display), `created_at`, `last_used_at`, `revoked_at` |
| `payment_events` | **`(provider, id)`** | `service_key`, `ts`, `effective_ts`, `route`, `method`, `rail`, `network`, `amount_atomic`, `payer`, `pay_to`, `tx_hash`, `payment_id`, `status`, `latency_ms`, `backend_status`, `error`, `verification`, `verification_reason`, `matched_transfer` (unique), `self_pay`, `received_at` |
| `onchain_transfers` | `(tx_hash, log_index)` | `block`, `block_ts`, `from`, `to`, `value_raw`, `amount_atomic` |
| `gateway_transfers` | `id` | `from`, `to`, `amount_atomic`, `status`, `nonce`, `tx_hash`, `network`, `created_at`, `updated_at`, `polled_at` |
| `feedback` | `(agent_id, client, feedback_index)` | `value` numeric, `value_decimals`, `tag1`, `tag2`, `endpoint`, `feedback_uri`, `revoked`, `block`, `tx_hash` |
| `heartbeats` | `(service_key, ts)` | `provider`, `version`, `network`, `rails`, `gateway_balance_atomic`, `doctor_json` |
| `my_wallets` | `(provider, address)` | |
| `indexer_state` | `id` | `last_block` |

**`(provider, id)` rather than spec 08's global `id`.** A global key would let one provider block another's events by submitting their ids first.

## 8. Ingest

- `.strict()` zod schemas reject unknown fields, so a signature cannot be stored even by accident. `id` must match `chainpe_<hex>`, which is a hash of the
  payload rather than the payload (**source**, `paymentIdentifierFor`).
- More than 500 events, or a body over 1 MB: 413. Any `payTo` other than the key's provider: 403 for the whole batch, and the CLI drops that batch instead of retrying it.
- Replay rules: `completed` never changes, while `pending` or `failed` may become `completed`. Needed because a retried payment keeps the same id, and a later replay of a
  delivered payment produces a `failed` event with the same id (**source**, `toPaymentEvent`). A replay must not downgrade a real payment.
- A heartbeat's `serviceKey` must belong to the key's provider. `doctor` is size-capped at 64 KB.
- CSV cells starting with `=`, `+`, `-` or `@` are prefixed with `'`. `route` is provider-supplied, and accountants open these files.

## 9. Workers and limits

All run in one process, disabled with `WORKERS_ENABLED=false`. A rolling deploy may briefly run two, which is safe because every write is idempotent.

| Worker | Interval | Work |
|---|---|---|
| Arc indexer | 3 s | Section 4 |
| Gateway poller | 30 s | Providers with a Gateway event in the last 7 days, or any non-terminal transfer. By `to`, plus by id for events with no record |
| Reconciler | 3 s, and after each ingest | Unverified events from the last 7 days, and non-terminal Gateway ones |
| Cleanup | 10 min | Expired nonces and revoked sessions |

**Rate limits** (`express-rate-limit`, in memory, `trust proxy` = 1, one instance): nonce 20/min per IP, verify 10/min per IP, ingest 600/min per key and 1,200/min per IP, reads 300/min per session.

## 10. CLI

- **`chainpe login` writes only to the literal `~/.chainpe/config.json`, 0600, merging a `cloud` field.** It ignores `CHAINPE_CONFIG`. Otherwise,
  `CHAINPE_CONFIG=examples/arc-demo/config.json chainpe login` would put an ingest key into a **committed** file. The example-config test will also fail on `cpk_`.
- The proxy reads `CHAINPE_CLOUD_URL` and `CHAINPE_INGEST_KEY` (D6), then that file.
- Telemetry and heartbeat follow the brief, with the 2 s flush (D4). The event `error` field is capped.
- `chainpe doctor`, when logged in, sends its result in one heartbeat, because the proxy cannot run doctor against itself in a container.

**Not in this phase:** the Pro "continuous checks every 15 min" and alerts in `BUSINESS-MODEL.md`. Health shows what doctor last reported. Those stay in stretch.

## 11. Deploy and tests

- **Tests** use the local Homebrew Postgres, which is real Postgres and already running. Docker's daemon is off on this Mac.
- **Railway:** a new service, root `services/chainpe-cloud`, Node 22 Dockerfile, plus Postgres.
- **Variables** as in your F4 list, plus `SIWE_CLI_DOMAIN` (D2) and `CHAIN_ID=5042002`. `SIWE_DOMAIN` cannot be final until the Phase 6 dashboard has a host. F5 uses only the CLI domain.
