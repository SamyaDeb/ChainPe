# PRD — ChainPe on Arc

| | |
|---|---|
| Status | Build-ready, ETHGlobal Mumbai (Nov 2026) |
| Prize | Arc — "Arc Studio Continuity Track: Bring Your Project to Arc" ($3,000) |
| Starting point | ChainPe v1 on Avalanche C-Chain mainnet, deployed 2026-06-17 (tag `avalanche-june-2026`) |
| Owner | Akash |

## 1. One line

ChainPe turns any existing API into an agent-payable service on Arc in one command:
Circle settles the payment, Gateway handles nanopayments, Arc's ERC-8004 registry rates it,
and every registered developer gets a personalised dashboard.

## 2. Problem

Agents can already pay for APIs in USDC on Arc, but a developer who wants to sell still has to:

1. Write x402 middleware (Circle's seller guide: Node 22, Express, five packages, custom code).
2. Integrate a facilitator, including Circle's per-request EIP-712 seller proof and pending-settlement polling.
3. Add Gateway separately to accept sub-cent nanopayments.
4. Produce an OpenAPI spec and discovery metadata, then pass Circle's manual listing review.
5. Build their own analytics to see who paid, how much, and whether the service is healthy.

Most x402 sellers stay invisible: public audits of the x402 Bazaar found large shares of listings
dead, missing `/.well-known/x402`, or without an MCP surface. New sellers get no buyers.

## 3. User

**Primary: provider developers.** A solo developer or small team that already runs an HTTP API,
MCP server or AI agent (any language) and wants other agents to pay per call.

**Not a user (out of scope):** merchants selling goods, content or subscriptions to people.
Buyers (agents) are the demand side; ChainPe gives them an SDK and MCP wallet, but they are not
the customer we design for.

### Jobs to be done

| When I… | I want to… | So that… |
|---|---|---|
| have a working API | put a price on it without changing code | agents can pay me today |
| set a price | accept both normal and sub-cent payments | any agent can pay, whatever it funded |
| go live | be found by agents and pass Circle's listing review | I actually get buyers |
| earn | see revenue, buyers, ratings and failures in one place | I know what to fix and what to charge |

## 4. Solution overview

| Layer | Provider | Notes |
|---|---|---|
| Standard settlement (x402 `exact`) | Circle Facilitator Service | Circle pays gas; seller proof per call |
| Nanopayments (batched) | Circle Gateway (`@circle-fin/x402-batching`) | Seller withdraws earnings |
| Discovery | Circle Discovery API + Agent Marketplace | ChainPe prepares listings |
| Identity + reputation | Arc canonical ERC-8004 registries | No ChainPe-owned 8004 contracts on Arc |
| Proxy, CLI, SDK, MCP wallet | **ChainPe** | Existing packages, ported |
| Provider accounts + plans | **ChainPe** `ChainPeAccounts` contract (Arc) | Built in Arc Studio |
| Personalised dashboard | **ChainPe** (frontend built in Arc Studio) | Business model, see BUSINESS-MODEL.md |
| Cloud API | **ChainPe** `chainpe-cloud` | Auth, telemetry, Arc indexing |

## 5. Scope

### 5.1 MVP (must ship at the hackathon)

| ID | Requirement | Spec |
|---|---|---|
| M1 | `arc` and `arc-testnet` networks across CLI, SDK, wallet, agent; Avalanche untouched | 01 |
| M2 | Migrate to x402 v2 (`@x402/*` 2.30.x) | 01 |
| M3 | Settle `exact` payments through Circle Facilitator with seller proof; handle `settlement_pending` | 02 |
| M4 | Accept Gateway nanopayments alongside `exact` in the same 402 | 03 |
| M5 | `chainpe start --network arc[-testnet]` forwards only after settlement `completed` | 04 |
| M6 | `chainpe doctor` — OpenAPI, `/.well-known/x402`, discovery metadata, live probe, intake fields | 05 |
| M7 | `chainpe register` — provider account + service on `ChainPeAccounts` (Arc), ERC-8004 identity | 06, 10 |
| M8 | Personalised dashboard for registered providers (wallet sign-in) | 07, 08 |
| M9 | Buyer SDK + MCP wallet pay on Arc (both rails) and rate after paid calls | 09, 10 |
| M10 | Contracts and dashboard built and deployed through Arc Studio; shareable Studio URL | ARC-STUDIO |

### 5.2 Stretch

| ID | Requirement | Spec |
|---|---|---|
| S1 | PolicyVault on Arc with on-chain overspend revert | 11 |
| S2 | Pro plan purchase in USDC from the dashboard | 06, 07 |
| S3 | Wrap MCP tools behind the proxy with per-tool prices | 04 |
| S4 | Email/Telegram alerts for failed settlements and endpoint downtime | 08 |

### 5.3 Out of scope

- Running our own facilitator or indexer for Arc (Circle replaces them).
- ChainPe-owned ERC-8004 contracts on Arc.
- Avalanche ICM/Teleporter cross-L1 contracts.
- Taking a percentage at the moment of payment (not possible with Circle's seller-signed facilitator). ChainPe collects its usage fee afterwards: see `specs/12-usage-fees.md`.
- Merchant checkout, refunds, invoices.

## 6. User flows

### 6.1 Provider: zero to paid (target: under 10 minutes)

1. `npm i -g @chainpearc/cli`
2. `chainpe init --network arc-testnet` → target URL, price, payout wallet.
3. `chainpe login` → signs a message with the payout wallet; gets a dashboard session + ingest key.
4. `chainpe register` → `ChainPeAccounts.registerProvider` + `registerService`, ERC-8004 identity minted/linked.
5. `chainpe start` → proxy on `:4402` (default port), 402 lists `exact` + Gateway options.
6. `chainpe doctor` → all checks pass; prints Circle "Get listed" intake fields.
7. Open `https://<dashboard>/` → connect the same wallet → sees their own services, revenue, buyers, ratings.

### 6.2 Buyer agent: find, pay, rate

1. `cp.discover({ query })` → Circle Discovery API (falls back to `ChainPeAccounts` services).
2. `cp.fetch(url)` → 402 → pays `exact` or Gateway (whichever is funded) → 200.
3. `cp.giveFeedback(agentId, score)` → Arc ERC-8004 ReputationRegistry.

### 6.3 Provider: earn and withdraw

1. Dashboard shows `exact` revenue (on-chain USDC to `payTo`) and Gateway balance (reported by CLI).
2. `chainpe withdraw <amount>` moves Gateway earnings on-chain (key never leaves the developer's machine).

## 7. Functional requirements (summary — details in specs)

- **Pricing:** default price per request in USDC; per-route overrides via `routes.json`; min `0.000001` on Gateway.
- **402 response:** x402 v2 `PAYMENT-REQUIRED` with two `accepts`: `exact` on Arc (asset `0x3600…0000`, `extra.name "USDC"`, `version "2"`) and Gateway (`extra.name "GatewayWalletBatched"`).
- **Settlement gate:** backend is called only after `success: true` (exact) or Gateway settle success.
- **Idempotency:** every settle carries `extensions.payment-identifier.info.id` (16–128 chars) derived from the request.
- **Telemetry:** proxy posts paid-call events to `chainpe-cloud` with the ingest key (route, rail, amount, payer, tx/paymentId, latency, status). Opt-out flag `--no-telemetry`.
- **Dashboard access:** wallet signature (SIWE-style) proves ownership of a provider address registered in `ChainPeAccounts`.
- **Plans:** Free and Pro, enforced by `ChainPeAccounts.planOf(provider)`; see BUSINESS-MODEL.md.

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | Private keys only on the developer's machine or env; never sent to cloud or Arc Studio |
| Correctness | No content served on `settlement_pending` or failed settle |
| Latency | Proxy overhead ≤ 1.5 s p50 for `exact` on Arc testnet (Arc finality < 1 s) |
| Compatibility | Node ≥ 22.18 for CLI (Circle requirement); SDK works in Node ≥ 20 |
| Backwards compat | `avalanche` / `fuji` keep working with x402 v2 |
| Observability | `/chainpe-admin/health` and `/chainpe-admin/stats` keep working |

## 9. Success metrics

**Hackathon (by submission):**

- ≥ 1 real `exact` settlement and ≥ 1 Gateway payment on Arc, with tx/payment ids shown in the dashboard.
- ≥ 2 providers registered on `ChainPeAccounts` (demo seller + one more real API).
- `chainpe doctor` passes on the demo seller; Circle listing form submitted.
- Shareable Arc Studio project URL with the contracts and dashboard.

**30 days after:**

- 25 registered providers, 5 with paid calls from wallets they do not control.
- 3 Pro subscriptions paid in USDC on Arc.

## 10. Risks

| Risk | Mitigation |
|---|---|
| No production Circle API key | Keyless trial on testnet; key requested from Circle mentors |
| Gateway mainnet needs funded buyer deposits | Demo Gateway on testnet; mainnet URL is the SDK default `https://gateway-api.circle.com` |
| Arc Studio upload limits (100 files, 1 MB each, 10 MB total) | Send only `contracts/` and the dashboard spec, not the monorepo |
| x402 v2 migration breaks Avalanche | Network-specific tests; keep v1 code path until v2 passes on `fuji` |
| Telemetry trust | Open-source proxy, opt-out flag, on-chain data as source of truth for `exact` revenue |

## 11. Open questions

- Pro plan price (default in docs: 19 USDC / 30 days) — owner decision.
- Can one project enter more than one Arc prize? Ask organisers.
- Seller-proof `chainId` is derived by the SDK (`chainIdFromNetwork`); confirm once on mainnet.
