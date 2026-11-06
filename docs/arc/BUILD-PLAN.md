# Build plan

**What is left to do now lives in [HACKATHON-PLAN.md](HACKATHON-PLAN.md).**

Build in this order. A real Arc payment must work before anything is polished. Each phase ends with
an acceptance check; do not start the next phase until it passes (except where marked parallel).

| Phase | Goal | Specs | Who builds |
|---|---|---|---|
| 0 | Setup and proof of "before" | — | you |
| 1 | Paid call on Arc testnet (exact rail) | 01, 02, 04 | Claude Code |
| 2 | Gateway nanopayments rail | 03 | Claude Code |
| 3 | Contracts on Arc (accounts, plans) | 06 | **Arc Studio** (run 1) |
| 4 | Register + identity + doctor | 05, 06, 10 | Claude Code |
| 5 | chainpe-cloud API | 08 | Claude Code |
| 6 | Provider dashboard | 07 | **Arc Studio** (run 2, 3) |
| 7 | Buyer side on Arc | 09, 10 | Claude Code (parallel with 5–6) |
| 8 | Proof, deploy, submission | SUBMISSION | you + Claude Code |
| S | Stretch: PolicyVault, Pro purchase, MCP wrap, alerts | 11, 06, 07, 08 | after 8 is safe |

## Phase 0 — setup

- [ ] `git checkout -b arc`; `git tag avalanche-june-2026 <last June commit>`; push tag.
- [ ] Install: Node 22.18+, `@circle-fin/arc-studio-cli`, `arc-studio skills install --tool claude-code`, `arc-studio login`, Arc docs MCP.
- [ ] Wallets: `seller` (payout), `buyer`, `deployer`. Fund all from `https://faucet.circle.com` (Arc testnet USDC = gas too).
- [ ] Ask Circle mentors: production facilitator API key and mainnet seller-proof chainId (the SDK handles it, confirm once).
- [ ] Confirm submission deadline on the ETHGlobal page.

**Accept:** branch + tag exist; `arc-studio doctor` OK; three funded testnet wallets.

## Phase 1 — exact rail on Arc testnet

- [ ] Spec 01: add `arc`, `arc-testnet` to `packages/chainpe/src/chains.ts`, `packages/chainpe-sdk/src/networks.ts`, `packages/chainpe-wallet/src/config.ts` (+ types), agent config.
- [ ] Spec 01: replace `x402`, `x402-express`, `x402-fetch` with `@x402/*` 2.30.x in CLI first.
- [ ] Spec 02: `CircleFacilitatorClient` (seller proof, settle, pending polling, payment-identifier).
- [ ] Spec 04: proxy uses it for `arc*`; forwards only on `completed`.
- [ ] Test: `examples/weather-api` behind `chainpe start --network arc-testnet`; pay with `chainpe fetch`.

**Accept:** one paid call returns 200; tx visible on `explorer.testnet.arc.io`; unpaid call returns 402 with an `eip155:5042002` exact option; `fuji` still works.

## Phase 2 — Gateway rail

- [x] Spec 03: `RailRouter` over `SettlementGuard` + `GatewayGuard`; both options in one 402 (see 03a).
- [x] Buyer deposits to Gateway (`GatewayClient`), pays a $0.001 route.
- [x] `chainpe balance`.
- [x] `chainpe withdraw <amount>` and `--all`: completed on-chain (see 03a "Live results").

**Accept:** a $0.001 call settles through Gateway; seller Gateway balance increases; withdraw works.

## Phase 3 — contracts in Arc Studio

- [x] ARC-STUDIO.md run 1 with `prompts/studio-01-contracts.md`, then run 1b with the review fix.
- [x] Pull to `contracts-arc/`; record address + traceId in `STUDIO-LOG.md`.

**Accept:** `ChainPeAccounts` deployed on Arc testnet; Foundry tests pass; ABI committed at `contracts-arc/abi/ChainPeAccounts.json`.

## Phase 4 — register, identity, doctor

- [x] Spec 10: `chainpe identity` (ERC-8004 register on Arc), reuse in `register`.
- [x] Spec 06: `chainpe register` / `deregister` / `list` on `ChainPeAccounts` for `arc*`.
- [x] Spec 05: `chainpe doctor`.

**Accept:** demo seller registered with an agentId; `chainpe doctor` all green; `chainpe list --network arc-testnet` shows it.

## Phase 5 — chainpe-cloud

- [x] Spec 08: rename/fork `services/chainpe-indexer` → `services/chainpe-cloud`; auth, ingest, Arc indexer, read API.
- [x] `chainpe login` in CLI; proxy telemetry.
- [x] Deploy (Railway) with Postgres; set `CHAINPE_CLOUD_URL`.

**Accept:** a paid call appears in `GET /v1/me/payments` within 5 s; a wallet that is not the provider gets 403.
Use a third wallet for that test: the smoke test made the buyer wallet a provider too.

## Phase 6 — dashboard in Arc Studio

- [x] ARC-STUDIO.md run 2, then run 3.
- [x] Pull to `apps/arc-dashboard`; deploy (Vercel); keep Studio workspace URL.

**Accept:** connecting the seller wallet shows only its services, revenue (exact + Gateway), buyers, ratings, doctor status; another wallet (a third one, not the buyer, which is also a provider) sees nothing.

## Phase 7 — buyer side (parallel with 5–6)

- [x] Spec 09: SDK `network: 'arc' | 'arc-testnet'`, both rails, Circle Discovery in `discover()`.
- [x] MCP wallet tools on Arc; `transfer_avax` removed; gas shown in USDC.
- [x] Spec 10: `giveFeedback` to Arc ReputationRegistry (simulated against the live registry; no paid rating yet).

**Accept:** Claude (MCP wallet) finds the demo seller, pays it on both rails, and leaves a rating that the dashboard shows.

## Phase 8 — proof and submission

- [ ] Deploy demo seller publicly; run ≥ 10 paid calls from the buyer wallet and ≥ 1 from a second person's wallet.
- [ ] If a production Circle key arrives: deploy `ChainPeAccounts` on mainnet, one real mainnet payment.
- [ ] `chainpe doctor` → submit Circle "Get listed" form.
- [ ] SUBMISSION.md checklist, README "Before / During", architecture diagram, video.
- [ ] Fix site copy: "native AVAX" → USDC; remove placeholder testimonial and "0.99% uptime"; GitHub links → `SamyaDeb/ChainPe`; changelog dates.

## Commit discipline

- One commit per checklist item; message prefix `arc:`; push every phase.
- Never squash; judges compare dated commits against the June tag.
