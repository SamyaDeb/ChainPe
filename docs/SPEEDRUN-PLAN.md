# ChainPe × Avalanche Speedrun — Implementation Plan

> Working plan, made 2026-11-14 from a full-repo review (contracts, services, packages, apps) and research on the event.
> Do the phases in order. Each phase stands on its own: if time runs out, submit what you have.
> Tick the boxes as you go. Each phase ends with a **commit point**.

---

## The pitch (keep every phase pointed at this)

> **Reputation you can't fake.** On ChainPe, only agents that actually paid for a service can rate it, and an
> agent's on-chain budget refuses to pay providers with a bad record. x402 payments + ERC-8004 reputation +
> PolicyVault caps in one loop, live on Avalanche mainnet.

### What the judges score

| Criterion | Weight | Phases that earn it |
|---|---|---|
| Does it work | 30% | 1, 2, 4 |
| Idea / originality | 25% | 3 |
| Technical depth | 20% | 3, 5 |
| Avalanche fit | 15% | 3, 5 (ICM), mainnet |
| Demo / communication | 10% | 4, 6 |
| **Bonus** | — | mainnet ✅ already · ICM/ICTT (Phase 5) · open-sourced reusable kits (facilitator, MCP wallet) |

### Submission checklist (Builder Hub)
- [ ] Name and one-liner
- [ ] Full description: problem, users, what it does
- [ ] Tech stack with the Avalanche-specific parts called out
- [ ] Live link (app plus Snowtrace addresses)
- [ ] Public repo
- [ ] Demo video, 3 minutes or less
- [ ] Pitch slides
- [ ] Team members added on the Builder Hub
- [ ] AI-tool disclosure
- [ ] **What existed before the Speedrun vs. what you added during it**, kept clearly separate

---

## Phase 0: Confirm the deadline (5 min)

- [ ] Check the [event page](https://build.avax.network/events/3f8d455d-1eb5-425b-b859-4261a0ff8ad6) or ask Team1 India which deadline applies. The page lists both **Nov 15 04:29 IST** (= Nov 14 22:59 UTC) and **Oct 21**.
- [ ] Check whether eligibility is limited to India.
- [ ] **If the deadline is tonight:** do Phase 1 → Phase 2 → Phase 6 only.

---

## Phase 1: Security fixes for the demo (≈2–3h)

Anyone (a judge, another team) could hit these live. Fix them before you show the project to anyone.

### 1.1 Facilitator only settles real ChainPe payments
File: `services/chainpe-facilitator/src/server.ts` (`/verify` ≈ line 199, `/settle` ≈ line 214)

- [x] Add a `validateRequirements(requirements)` guard, called by both `/verify` and `/settle` **before** `verify()`/`settle()`:
  - `requirements.network === X402_NETWORK`
  - `requirements.scheme === "exact"`
  - `requirements.asset` (lowercased) equals the USDC address for this network (mainnet `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`; Fuji `0x5425890298aed601595a70AB815c96711a31Bc65`)
  - `requirements.extra?.name === "USD Coin"` and `extra?.version === "2"`, the EIP-712 domain of native USDC (confirm on-chain with `name()` / `version()` first)
  - `BigInt(requirements.maxAmountRequired) >= MIN_AMOUNT` (env, default `1000` = 0.001 USDC)
  - `payload.payload.authorization.to` equals `requirements.payTo`
- [x] **payTo allowlist:** only settle to payTo addresses of active registered services. Load the set from the chainpe-cloud API (or read `ChainPeRegistry` directly), cache it for 60s, and refresh it on a miss. Add an env escape hatch, `ALLOW_ANY_PAYTO=true`, for local dev only.
- [x] Reject with `400 { isValid:false, invalidReason:"unsupported_requirements" }`. Don't call the RPC.

### 1.2 The same signature can't be settled twice
Same file.

- [x] Keep an in-memory `Set<string>` of `${from}:${nonce}` for settles in flight. A second request for the same key returns `409 settle_in_progress`.
- [x] Before `settle()`, read USDC `authorizationState(from, nonce)` and reject if it's already `true`, as `400 nonce_used`. Do the same check in `/verify`.
- [x] Keep a short LRU (about 10k entries) of `(from, nonce)` pairs that settled successfully.

### 1.3 Rate limits that actually work
- [x] `app.set('trust proxy', 1)` in the facilitator (≈ line 70) and in `services/chainpe-indexer/src/api.ts` (≈ line 84). Railway puts one proxy in front.
- [x] Put the `apiLimiter` on `/status` too (it hits the RPC).
- [x] Log errors with `err.message` only, never the full object, so RPC URLs with keys don't leak.

### 1.4 CLI proxy
File: `packages/chainpe/src/proxy/server.ts`

- [x] Lines ≈101–103: only mount the local `/chainpe-facilitator/verify|settle` routes when `--facilitator` is set **and** bind them behind a shared secret header, or call the local facilitator in-process and don't expose HTTP routes for it at all. The in-process option is simpler.
- [x] Line ≈203: `ws: false`.
- [x] Lines ≈56–96: `/chainpe-admin/*` returns 404 unless `adminKey` is set. Accept the key only in the `x-admin-key` header, not as a query param, and compare it with `crypto.timingSafeEqual`. Remove `targetUrl` from `/config`.
- [x] `cli.ts` ≈ line 82: write `config.json` with `mode: 0o600`.

### 1.5 MCP wallet spending safety
Files: `packages/chainpe-wallet/src/spending.ts`, `src/tools/x402-fetch.ts`, `src/tools/transfer-avax.ts`

- [x] `spending.ts:16-18`: if `MAX_PER_CALL` / `MAX_PER_DAY` is `NaN` or ≤ 0, throw at startup, or fall back to a safe default (0.10 / 1.00 USDC). Never fall back to "no limit".
- [x] `x402-fetch.ts` ≈229–272: call `spending.record()` **right after signing**, before the retry. The money is committed once the signature exists.
- [x] Reject offers whose `maxTimeoutSeconds` is over 300.
- [x] `transfer-avax.ts`: add a `MAX_AVAX_PER_TRANSFER` cap (default 0.1) and a daily cap.
- [x] Don't auto-post feedback when the paid response is ≥ 400.

### 1.6 Agent budget
Files: `packages/chainpe-agent/src/agent.ts` (≈92), `src/payment.ts` (≈44, 115, 121), `src/types.ts` (≈37)

- [x] Pass `maxPerPayment` from the config's `maxPricePerRequest`, and change the default from 10 USDC to 0.10.
- [x] Record the **real** amount from the signed authorization and the real recipient (`authorization.to`), not the registry price or `decoded.payer`.

### 1.7 Mainnet defaults and address drift
- [x] Add the mainnet registry `0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E` and reputation `0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543` to:
  - `packages/chainpe-wallet/src/reputation.ts:22`
  - `packages/chainpe-wallet/src/chainpe-registry.ts:130`
  - `packages/chainpe-agent/src/reputation.ts:21`
  - `packages/chainpe-agent/src/registry.ts:122`
  - `packages/chainpe/src/registry.ts:154`
- [x] Add the mainnet IdentityRegistry `0xB1330d7B1b083ba689C7f56bDf667F1F528a3195` to `packages/chainpe/src/erc8004.ts:49-51`. Without it, `chainpe register` on mainnet skips the identity mint.
- [x] Switch the default network to `avalanche` in:
  - wallet `config.ts:16`
  - wallet `manifest.json`
  - the wallet tools' `.default('fuji')`, which should read `config.network`
  - agent `config.ts:150`
  - CLI `--network`
- [x] Wallet `x402-fetch.ts:260-262`: show the Fuji faucet links only on Fuji.
- [x] `packages/chainpe-ai-tools/package.json:37`: depend on `@chainpeavax/sdk ^0.2.0`, then bump the ai-tools version.

### 1.8 Indexer config
- [x] `services/chainpe-indexer/src/config.ts:46-48`: set the `LOG_CHUNK` default to `100`, default `START_BLOCK` to the registry deploy block (used 88207990, matching chainpe-cloud: reputation deployed at 88207994, registry proxy at 88208064; 88233000 would skip early events), and use mainnet address defaults.
- [x] `services/chainpe-cloud/src/config.ts:26`: set the `GETLOGS_MAX_BLOCKS` default to `100`.

### ✅ Done when
- [x] Unit tests cover the facilitator: a wrong asset is rejected, a wrong network is rejected, an unregistered payTo is rejected, a reused nonce is rejected, and a valid payment still settles.
- [x] `npm test` at the root passes, and so do the facilitator's tests.
- [ ] One real 0.01 USDC mainnet payment still works end to end (`e2e/mainnet-real-usdc.mjs`).
- [ ] **Commit point:** "Speedrun: harden facilitator, proxy, wallet and agent payment safety"

---

## Phase 2: Honest site that judges can use (≈1–2h)

### 2.1 Broken links and addresses
- [x] Replace `0xfe7Df66e6BFbd3A76B68dDF26b9312E6c85a38543` (41 hex characters, invalid) with `0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543` in:
  - `apps/landing/content/docs/changelog.md:13,86`
  - `apps/landing/content/docs/concepts/erc-8004-reputation.md:69`
  - `apps/landing/content/docs/getting-started/installation.md:86`
  - `apps/landing/content/docs/smart-contracts/overview.md:21`
  - `packages/chainpe-sdk/README.md:86`
- [x] Change `https://chainpe.xyz/docs` to `/docs` in `apps/landing/components/landing/developers-section.tsx:224` and `footer-section.tsx:15` (chainpe.xyz is a parked domain).
- [x] Code samples:
  - `developers-section.tsx:21`: `network: 'mainnet'` → `'avalanche'`
  - `content/docs/concepts/x402-protocol.md:128`: `'avalanche-fuji'` → `'fuji'`
- [x] `docs/DEPLOYMENTS.md:21`: the fee is **1 USDC**, not 0.1.
- [x] Footer `href="#"` links: point them at real pages or remove them.

### 2.2 Remove claims you can't back up
- [x] `pricing-section.tsx`: remove the invented "$0.003 per settlement" fee. The real costs are the 1 USDC registration fee plus gas, which the facilitator pays. Wire up the buttons, or remove them.
- [x] Use one gas figure everywhere. `hero-section.tsx:153` says $0.0003 and `infrastructure-section.tsx:65` says $0.003; pick the measured one from `docs/WHY-AVALANCHE.md`. _(Done: `~$0.003` from `lib/proof.ts`, labelled as an estimate at 1 gwei.)_
- [x] `metrics-section.tsx`: remove "99.99% uptime".
- [x] `testimonials-section.tsx`: delete the whole section.
- [x] In their place, add a **proof strip** above the fold: verified contract links, the latest settlement tx, live "USDC settled / paid calls / services" counts (from the Phase 4 API, or hardcoded for now). _(Done: `components/landing/proof-strip.tsx` reads `lib/proof.ts`. Counts stay hidden until the Phase 4 stats API exists; no numbers were hardcoded.)_

### 2.3 Delete dead weight
- [x] Delete `apps/dashboard/`, which is not deployed, says "native AVAX" and uses the wrong package names.
- [x] Delete `apps/landing/public/docs/` and `apps/dashboard/public/docs/`, the old Docusaurus builds that still show Fuji addresses.
- [x] Root `package.json`: remove `dev:docs`, `dev:docs:rebuild` and `dev:all` (they point at a `website/` folder that no longer exists).
- [x] Delete `apps/landing/test-types.tsx`, which breaks `tsc`. Then set `ignoreBuildErrors: false` in `apps/landing/next.config.mjs:6`.
- [x] Docs pages that describe the old marketplace (`introduction.md:45,85,93`, `troubleshooting/common-issues.md:145-152`): replace them with the real `/dashboard` and `/explore`. _(Done: they point at `/dashboard`. `/explore` is not linked yet because it ships in Phase 4.)_
- [x] Dashboard dead code: the `fees()` / `PlanName` / `plan_required` / `'pro'` mock scenario in `apps/avalanche-dashboard/src/api/*`, `mock/*` and `hooks/useResource.ts`.

### 2.4 Put real services on mainnet
An empty registry ruins every demo.

- [ ] Deploy `examples/weather-railway` plus `examples/proxy-railway` (or one proxy with 2 routes) on Railway, pointed at the hosted facilitator. _(Prepared: weather-railway serves `/weather`, `/summarize`, `/cheap-weather`; proxy-railway gates them with per-route payTo; `register.sh` is ready. Not deployed yet.)_
- [ ] Register **2 services** on mainnet with `chainpe register --network avalanche`: `weather` at $0.01 and an AI endpoint such as `summarize` or `price-oracle` at $0.02. Make sure each gets an ERC-8004 identity (this needs the 1.7 fix).
- [ ] Register a **third, deliberately bad service** ("cheap-weather", returns junk). Phase 3 uses it to show low-reputation spending being refused.
- [ ] Confirm all three appear on chainpe-cloud and the indexer.

### ✅ Done when
- [x] `next build` and `tsc` pass in `apps/landing` with no ignored errors.
- [ ] Every link on chainpe.vercel.app works.
- [ ] The registry shows 3 services.
- [ ] **Commit point:** "Speedrun: fix docs addresses and links, drop unbacked claims, remove dead apps"

---

## Phase 3: Headline feature, payment-gated reputation (≈4–6h)

The core idea:

```
agent pays (x402) ──► settlement tx T
agent rates: giveFeedback(agentId, score, …, feedbackHash = T)
indexer checks T: USDC transferWithAuthorization, from == rater, to == service.payTo
   ├─ valid   → counted as a "paid review", weighted by USDC paid
   └─ invalid → stored, shown as "unverified", NOT counted
PolicyVault / agent: refuse to pay services whose verified score is below the minimum
```

### 3.1 Clients attach payment proof to every rating
Files: `packages/chainpe-sdk/src/chainpe.ts` (≈361–400), `src/reputation.ts`, `packages/chainpe-wallet/src/tools/x402-fetch.ts` (≈92), `src/tools/give-feedback.ts`, `packages/chainpe-agent/src/reputation.ts`

- [x] After a successful paid call, read the settlement tx hash from the `X-PAYMENT-RESPONSE` header (base64 JSON, `transaction`).
- [x] Pass it as `feedbackHash` (bytes32 = the tx hash) and set `tag1 = "x402"`, `endpoint = <resource url>`.
- [x] Manual `give_feedback` / `cp.giveFeedback`: add an optional `paymentTx` parameter. Without it, the rating is still allowed but will show as unverified.
- [x] Stop trusting the server-supplied `x-chainpe-agent-id` header. Resolve agentId from the registry by payTo, and after 3.3 the registry check makes that safe. _(Done: the agentId is read from the on-chain registry by payTo in the SDK, wallet and agent. The header is ignored.)_

### 3.2 Indexer verifies the payment behind each rating (chainpe-cloud)
Files: `services/chainpe-cloud/src/schema.ts` (feedback table ≈172), `src/workers/indexer.ts` (≈323, NewFeedback handler), new `src/workers/verifyFeedback.ts`, `src/routes/me.ts` (`/me/reputation` ≈309), new drizzle migration

- [x] Migration: add these columns to `feedback`: _(Done: `drizzle/0002_phase3_payment_gated_reputation.sql`. Also adds `paid_to`, `verify_attempts`, `next_verify_at`, and `services.agent_id`.)_
  - `feedback_hash text`
  - `verified boolean default false`
  - `verification_reason text`
  - `paid_atomic numeric`
  - `payment_tx text`
- [x] The indexer stores `feedbackHash` from the `NewFeedback` event. It's already decoded in the ABI at line 18.
- [x] `verifyFeedback` worker. For each unverified row: _(Done: `src/workers/verifyFeedback.ts`. Extra reasons: `no_proof` (no hash), `self_rating`, `payment_after_feedback`, `tx_failed`, `receipt_not_found`, `service_unknown`. Unseen receipts retry with exponential backoff, 12 attempts.)_
  1. `getTransactionReceipt(feedbackHash)` and require `status == success`.
  2. Find the USDC `Transfer` log with `from == feedback.client` and `to == service.payTo` for the service that owns `agentId`.
  3. Require the USDC `AuthorizationUsed` event in the same tx, which shows it was an x402 / EIP-3009 payment rather than a plain transfer.
  4. Require that payment tx to be at or before the block the feedback was posted in.
  5. Require each payment tx to be used by **one** rating only (unique index on `payment_tx`).
  6. Set `verified=true` and `paid_atomic=amount`. Otherwise set a `verification_reason` such as `no_payment`, `wrong_payee`, `not_x402` or `reused`.
- [x] Score = Σ(score × min(paid, cap)) / Σ min(paid, cap) over verified rows. The cap (e.g. 1 USDC) stops one whale from dominating the score.
- [x] Also fix **payment attribution** in `src/workers/payments.ts:32-48`. Only count a transfer as an x402 payment if its tx emitted `AuthorizationUsed`. If two providers registered the same payTo, attribute it to the first registrant only and flag the later ones. _(Done: reads one extra `AuthorizationUsed` log scan per chunk, only when a transfer is in it. No call per transfer. The shared payTo goes to its earliest registrant; later services show `payToShared: true` in the public API.)_

### 3.3 Registry checks agentId ownership (UUPS upgrade on mainnet)
Files: `contracts/contracts/ChainPeRegistryUpgradeable.sol` (≈174 `register`, ≈201 `update`), new test, new script `contracts/scripts/upgrade-registry.ts`

- [x] In `register` and `update`, if `input.agentId != 0`, require `IIdentityRegistry(identityRegistry).isAuthorizedOrOwner(msg.sender, input.agentId)`. Otherwise revert `NotAgentOwner(agentId)`.
- [x] Make `deregister` work while paused, i.e. drop `whenNotPaused` (Low finding).
- [x] Bump `getVersion()`. _(Done: the registry had no `getVersion()`, so one was added returning `2.0.0`.)_
- [x] **Don't change the order of storage variables.** Append new ones only.
- [x] Install `@openzeppelin/hardhat-upgrades` and run `upgrades.validateUpgrade(proxy, NewImpl)` before deploying. _(Done with `@openzeppelin/hardhat-upgrades@3.9.1`: 4.x needs Hardhat 3. `validateUpgrade` runs against a frozen copy of the v1 source in tests and in `upgrade-registry.ts`.)_
- [x] Tests:
  - registering with someone else's agentId reverts
  - registering with your own agentId works
  - agentId 0 still works
  - existing registrations survive the upgrade (fork test)
- [ ] Upgrade on mainnet with the owner key. Save the tx hash for the README.

### 3.4 Public reputation API
File: new `services/chainpe-cloud/src/routes/public.ts`, mounted in `src/app.ts` with no session and its own rate limit.

- [x] `GET /v1/public/services` lists every active service with: name, endpoint, price, payTo, agentId, `paidScore`, `paidReviews`, `rawScore`, `rawReviews`, `totalSettledAtomic`, `paidCalls`.
- [x] `GET /v1/public/services/:key/reviews` returns a page of reviews with `verified` / `verification_reason` and the payment tx.
- [x] `GET /v1/public/feed?limit=50` returns the latest verified settlements (tx, service, amount, payer, time).
- [x] `GET /v1/public/stats` returns total USDC settled, paid calls, services and verified reviews.
- [x] Point SDK `discover()`, the agent and the wallet `search_bazaar` at `paidScore`, and drop the "average every client" path in `chainpe-wallet/src/reputation.ts:88` and `chainpe-agent/src/reputation.ts:99-107`. _(Done. The SDK `discover()`, the agent `discoverService` and the wallet `search_bazaar` use `paidScore`. If chainpe-cloud is unreachable they fall back to the on-chain average, labelled `unverified`.)_

### 3.5 Refuse to pay providers with a bad record

**Step A, in the client (required):**
- [x] SDK `ChainPe` option `minReputation` (0–100, plus `minPaidReviews`, default 3). Before signing, look up the service's `paidScore` by payTo. If it's below the minimum, throw `ReputationTooLow` and don't sign. _(Done. Fails closed if chainpe-cloud is unreachable, and an unrated provider is refused unless `minPaidReviews: 0`.)_
- [x] Wallet: add env `MIN_REPUTATION`, and have `x402_fetch` return a clear refusal message so Claude explains it.
- [x] Agent: add `minReputation` to the config. The planner picks the **cheapest service above the minimum**.

**Step B, on-chain in PolicyVault (stretch, but the strongest demo line):**
File: `contracts/contracts/PolicyVaultUpgradeable.sol`

- [x] Add a new contract, `ChainPeReputationOracle`: `score[payTo]` set by an attester key, run by the chainpe-cloud worker, plus `updatedAt`.
- [x] PolicyVault upgrade: append storage `address reputationOracle; mapping(address => uint8) minScoreOf;`, add `setMinScore(uint8)`, and in `spend()` add `if (minScoreOf[owner] > 0 && oracle.score(to) < minScoreOf[owner]) revert ProviderReputationTooLow();`. _(Done: also `sessionEpoch` storage and `setReputationOracle`. Contracts and tests are done; the mainnet upgrade is below.)_
- [x] Fix while you're in there:
  - `setPolicy` should not reset `totalSpent`
  - add a session `epoch` to `SPEND_TYPEHASH` so `revokeSession` really kills old signatures
- [ ] Run `validateUpgrade`, add tests, upgrade on mainnet, save the tx hashes.

### 3.6 Make the reputation data real
- [ ] Use 3–5 separate agent wallets to pay `weather` and the AI service several times each, with good ratings (the payment hash is attached automatically).
- [ ] Rate `cheap-weather` low through paid calls.
- [ ] Add 5 **unpaid** high ratings to `cheap-weather` from fresh wallets. The demo shows them being ignored: "raw 4.9★ (12), paid 1.2★ (4)".

### ✅ Done when
- [ ] The public API shows a paid score that differs from the raw score for `cheap-weather`.
- [ ] A Claude MCP wallet with `MIN_REPUTATION=60` refuses `cheap-weather` and pays `weather`.
- [ ] The registry upgrade is live on mainnet and an agentId-hijack attempt reverts. Save that tx.
- [ ] **Commit point:** "Speedrun: payment-gated ERC-8004 reputation, registry agentId ownership, reputation-gated spending"

---

## Phase 4: Pages that need no wallet (≈3–4h)

Lives in `apps/avalanche-dashboard` (already served at `/dashboard`), as new **public** screens that need no sign-in.

### 4.1 `/dashboard/explore`: public live explorer
- [x] New `src/screens/Explore.tsx` and a route in `App.tsx` / the router that skips the auth gate.
- [x] Stats row (from `/v1/public/stats`): USDC settled, paid calls, services, verified reviews.
- [x] Live feed (poll `/v1/public/feed` every 5s): time, service, amount, payer (short), Snowtrace link.
- [x] Service cards (from `/v1/public/services`): price, **paid score with review count**, raw score shown faded, "x402 · USDC · ERC-8004 #id" badges, and a "Verified onchain" link.
- [x] Service detail drawer: reviews list with ✓ verified / ✗ unverified and the reason.
- [x] Add an "Explore" link in the landing nav and hero CTA.

### 4.2 "Try it now": a paid call in the browser
- [x] On a service card, a **Try it, $0.01** button opens a modal that uses wagmi (already configured for Avalanche mainnet).
- [x] Step through it visibly:
  1. `GET` → **402** (show the requirements JSON)
  2. sign the EIP-3009 authorization (`signTypedData`)
  3. retry with `X-PAYMENT` and show the response body
  4. show the settlement tx with a Snowtrace link
  5. optionally rate 1–5★ → `giveFeedback` with `feedbackHash` = tx (costs a little AVAX gas), then show "✓ verified paid review"
- [x] CORS: the demo proxy must allow the dashboard origin and expose the `X-PAYMENT-RESPONSE` header.

### 4.3 Sample provider view
- [x] A "View sample provider" button on the sign-in screen opens a read-only dashboard for **your** demo provider address, through a public read-only endpoint (`/v1/public/providers/:address/summary`). Alternatively, ship mock mode with its "Sample data" banner, but real data is better. _(Done: `/dashboard/sample`. The endpoint serves only addresses in `SAMPLE_PROVIDERS` (chainpe-cloud); the dashboard reads `VITE_SAMPLE_PROVIDER`. Both must be set on deploy.)_

### 4.4 Landing hero
- [x] Replace the generic hero copy with the pitch line, plus 3 proof chips: "Live on Avalanche mainnet", "N USDC settled", "Paid-only reviews".

### ✅ Done when
- [ ] In a private window, with no wallet: landing → Explore → see live payments and scores → open the sample provider. Under 60 seconds.
- [ ] With a wallet: Try it → pay → rate → the review appears as verified.
- [ ] **Commit point:** "Speedrun: public explorer, in-browser paid call, sample provider view"

---

## Phase 5 (stretch): Real cross-L1 with ICM (≈4–6h)

Only start this if Phases 1–4 are done. It earns the ICM bonus.

**Goal: portable reputation.** A service's verified reputation summary is sent over Teleporter to another L1, so an agent on that L1 can check it before hiring.

- [x] `contracts/contracts/icm/ChainPeICMReceiver.sol:66-69`: **fail closed**. An unset `trustedSenders[chainId]` must revert. Add a test.
- [x] Use **Fuji C-Chain plus a public Fuji L1** (e.g. one listed in the Builder Console), or launch your own Fuji L1 with the Builder Console, which also earns the "own L1" bonus.
- [x] New `ChainPeReputationMirror` on the L1: it receives `(payTo, agentId, paidScore, paidReviews, timestamp)` from the trusted C-Chain sender and stores it.
- [x] On C-Chain: the attester (or anyone, gated by the oracle) calls `ICMSender.sendReputation(destChainId, payTo)`, which reads `ChainPeReputationOracle` and sends the message.
- [x] Run or use an ICM relayer. Public Fuji relayers relay messages between Fuji chains; confirm in the Builder Hub docs.
- [x] Demo: send it on Fuji C-Chain, read it on the L1 within seconds, and show both explorer links.
- [ ] Optional: an ICTT USDC transfer alongside it, so an L1 agent can fund payments on C-Chain.
- [x] Update the README so the ICM claim matches exactly what works.
- [ ] **Commit point:** "Speedrun: ICM portable reputation (fail-closed receiver, L1 mirror)"

---

## Phase 6: Submission package (≈2h)

### 6.1 Demo video (≤ 3 min), script
| Time | Shot |
|---|---|
| 0:00–0:15 | Problem: agents can't pay, and nobody can trust reputation (fake reviews cost nothing). |
| 0:15–0:35 | Landing → Explore: live mainnet payments and paid-only scores ("raw 4.9★ vs paid 1.2★"). |
| 0:35–1:30 | Claude with the MCP wallet: "get me the weather in Delhi". It discovers services, **refuses cheap-weather (low paid reputation)**, pays `weather` $0.01, and gets the result. Then show the Snowtrace tx. |
| 1:30–1:55 | Budget: ask for 50 calls, and PolicyVault / the spending cap refuses. |
| 1:55–2:20 | The agent posts a rating with the payment hash attached, and it appears as ✓ verified in Explore. |
| 2:20–2:45 | Provider side: `chainpe start` + `register`, then the dashboard shows the revenue. (Optional: the ICM mirror on an L1.) |
| 2:45–3:00 | Architecture in one frame, what was built during the Speedrun, and the links. |

- [ ] Record it (the cap-director skill can drive the recording and zooms).
- [ ] Upload it, then link it in the README and the submission.

### 6.2 Slides (6–8)
- [ ] Problem → Solution loop diagram → Live proof (addresses and txs) → Built during the Speedrun → Why Avalanche → Roadmap → Links

### 6.3 Builder Hub form
- [ ] Fill in every field from the checklist at the top, including the AI-tool disclosure and the before/after split.

---

## Phase 7: README update (do this last, matching only what shipped)

Edit `README.md` top to bottom:

- [x] **1. Header:** replace the tagline with the pitch line. Add badges: "Avalanche Speedrun 2026", the real test count.
- [x] **2. New "🏁 Built during the Avalanche Speedrun" section, right under the header.** A table of each feature, with columns Phase | What | Proof (tx / link) | Commit:
  - Payment-gated ERC-8004 reputation (Phase 3)
  - Registry agentId ownership upgrade, with the mainnet upgrade tx
  - Reputation-gated spending (SDK / MCP / agent, plus the PolicyVault upgrade tx if shipped)
  - Public explorer, try-it-now and sample provider (Phase 4)
  - Facilitator and proxy hardening (Phase 1)
  - ICM portable reputation (Phase 5, only if shipped)

  Then one line: "Everything else below existed before the Speedrun (deployed 2026-06-17)."
- [x] **3. "Try it in 60 seconds" (for judges):** _(Done; add the demo video link once it's recorded.)_ links to Explore, the sample provider, and try-it-now, plus the demo video.
- [x] **4. Problem / Solution:** keep it, but replace the "Reputation on every paid call" row with "**Only paying agents can rate**: each review carries its settlement tx; fake reviews are shown but not counted."
- [x] **5. New section "How payment-gated reputation works":** a mermaid sequence diagram (pay → settle → giveFeedback(feedbackHash = tx) → indexer verifies `AuthorizationUsed` + payee → weighted paid score → client / PolicyVault gate).
- [x] **6. Architecture diagram:** add chainpe-cloud (indexer, verification, public API) and the Explore page. Mark the old `chainpe-indexer` as legacy or remove it if retired.
- [x] **7. Contracts table:** _(Done: unverified "✓ verified" claims removed; a mainnet rollout table lists the pending upgrades.)_
  - double-check every address (especially ReputationRegistry `…68dF26…`)
  - add implementation versions and upgrade tx hashes
  - add ReputationOracle / Mirror if deployed
  - only write "✓ verified" for contracts actually verified on Snowtrace (verify the mainnet proxies and implementations first)
- [ ] **8. Proof of work:** add the new mainnet txs (a gated paid review, a refused low-reputation payment, the registry upgrade, the agentId-hijack revert), next to the existing June txs.
- [x] **9. Cross-L1 via ICM:** describe exactly what works (Fuji C-Chain → L1 mirror with explorer links) or label it "Roadmap". No loopback claims.
- [x] **10. Testing:** run everything and paste the real numbers (contracts N passing, sdk / wallet / ai-tools / cloud / facilitator). Gate the live E2E behind `RUN_LIVE_E2E=1` so `npx hardhat test` is green.
- [x] **11. New section "Security & trust model":**
  - the owner key and upgrade powers (plus a timelock or Safe, if you move ownership)
  - facilitator protections (asset, network, payTo allowlist, nonce dedupe, rate limits)
  - client spending caps
  - known limitations
- [x] **12. Why Avalanche:** keep it, and add native USDC (CCTP), ERC-8004 on C-Chain, ICM, and the fact that Coinbase's hosted x402 service doesn't support Avalanche mainnet (so a hosted Avalanche facilitator fills a gap).
- [x] **13. Roadmap:** x402 v2 (CAIP-2, `PAYMENT-SIGNATURE`, SIWx sessions), a shared `@chainpeavax/core`, escrow and refunds, ICTT, batch settlement, settlement webhooks, retiring the duplicated indexer.
- [x] **14. AI tools disclosure** (a short section, which the rules ask for).
- [x] Also update `docs/CHANGELOG.md`:
  - a new "Speedrun" entry
  - remove the stale "optimistic proxying" wording (x402-express buffers the response until settlement)
  - remove "rate limiting" (it isn't implemented)
- [x] Also update `docs/DEPLOYMENTS.md` and `docs/STRUCTURE.md` (remove `apps/dashboard`, `website/`).
- [ ] **Final commit point:** "Speedrun: README, changelog, deployments"

---

## Backlog: known issues not covered above (after the Speedrun)

- PolicyVault daily cap resets at UTC midnight (2× cap possible around midnight): move to a rolling window.
- `ChainPeICMReceiver` and `PolicyVaultUpgradeable` use single-step `Ownable`, but `scripts/transfer-ownership.ts` expects `acceptOwnership()`. Fix the script before moving to a Safe, and include the 3 ERC-8004 proxies.
- ERC-8004 `getSummary` / `readAllFeedback` loop over all clients, so spam can make reads run out of gas. Read from the indexer instead.
- ValidationRegistry `requestHash` can be front-run (upstream behaviour).
- The CLI proxy runs the backend before settlement. N concurrent requests with one authorization run the backend N times. Add an in-flight nonce lock in the proxy too.
- Duplicated registry and reputation clients across 4 packages: extract `@chainpeavax/core`.
- The old `services/chainpe-indexer` duplicates chainpe-cloud's indexer. Retire it, or serve discovery from cloud.
- `client:'cli'` SIWE accepted from any Origin (`services/chainpe-cloud/src/routes/auth.ts:61`).
- Stale `e2e/run.mjs` and `e2e/agent-to-agent.mjs` (Fuji, old URLs).
- Examples are hardcoded to Fuji.
- Private keys stored in plaintext in `~/.chainpe/wallet.json`, and the agent prints generated keys to the terminal.
- Consider the canonical ERC-8004 Identity Registry on C-Chain (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, about 1,700 agents) so ChainPe agents join the shared graph.
