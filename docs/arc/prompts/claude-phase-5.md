You are a senior x402 / EVM payments and backend engineer continuing the ChainPe → Arc port.
Phases 1–3 are done and verified on-chain; Phase 4's code is done but its live acceptance is not.
This session: (E) finish Phase 4 live, then (F) build Phase 5 — `chainpe-cloud`, the backend behind the
personalised provider dashboard (our business model). The dashboard will show revenue to developers, so
every number must be either verified on-chain / by Circle, or clearly marked unverified.

Read first: CLAUDE.md, docs/arc/BUILD-PLAN.md (Phases 4–5), docs/arc/specs/08-chainpe-cloud-api.md,
specs 03a, 04, 05, 06, 10, docs/arc/BUSINESS-MODEL.md, docs/arc/reviews/chainpe-accounts-review.md,
docs/arc/PROOF.md, contracts-arc/deployments/arc-testnet.json, and services/chainpe-indexer/src/*
(the starting point: Express + Drizzle + pg + vitest). Use the arc-docs MCP for Arc facts and read SDK
sources in node_modules before relying on any API.

Verified state (checked on-chain 2026-11-06 08:30 IST via rpc.testnet.arc.io)
- ChainPeAccounts 0xD315322c9D83A6f50A04236A2a242e0259bfB580 (Arc testnet, source verified, deploy block
  70918643): owner = treasury = 0x3b8a312f…d30a, usdc = 0x3600…0000, identityRegistry = 0x8004A818…BD9e,
  proPricePerPeriod = 1 USDC (testnet), serviceCount = 3.
- payTo is bound to the provider (review M-1: payTo == msg.sender). So provider address == payTo.
- Seller 0x261f058496d81703c858ddfed201834f0b5f2e73: provider exists, Pro active, **agentId = 0, ERC-8004
  balanceOf = 0** — no identity minted yet. The buyer wallet is also a provider; use a THIRD wallet for
  "not my data" tests.
- CLI has identity/register/deregister/list/plan/upgrade/doctor (12 checks), tsc green, 194 vitest cases
  (run on my Mac; node_modules are darwin-native).
- examples/arc-demo (Dockerfile, start.sh, README) exists, but **examples/arc-demo/config.json is missing**
  although the Dockerfile sets CHAINPE_CONFIG to it — the container cannot start.

PART E — finish Phase 4 live (do this first; one commit per item, prefix `arc:`)
E1. Create examples/arc-demo/config.json with public values only (serviceName, description, tags,
    targetUrl http://127.0.0.1:3001, walletAddress = seller, network arc-testnet, rails, routes with a
    $0.001 and a $0.01 route, proxyPort, publicUrl = the Railway https URL). No keys. Add a test that fails
    if any config under examples/ contains a 64-hex private key.
E2. I will deploy it on Railway (tell me exactly which variables to set). After it is live:
    chainpe identity → agentId (explorer link); chainpe register → links agentId on ChainPeAccounts;
    chainpe list --mine; chainpe doctor (must be all green for checks 1–4, 6, 7, 9, 10; run --pay too).
    Append every tx to docs/arc/PROOF.md. Tick Phase 4 boxes in BUILD-PLAN.md.
E3. Submit nothing to Circle yet; print the "Get listed" intake fields from doctor into
    docs/arc/LISTING.md for me to submit.

PART F — Phase 5: chainpe-cloud

F0. Design note first (docs/arc/specs/08a-cloud-design.md), then STOP for my approval. Decide and justify:
  1. Auth: SIWE (EIP-4361) via `viem/siwe` (createSiweMessage / verifySiweMessage), single-use nonces
     (TTL 5 min, stored server-side), domain + uri + chainId 5042002 bound, expirationTime. Accept smart
     accounts via publicClient.verifyMessage (ERC-1271). Sign-in allowed only if
     ChainPeAccounts.providers(address).exists.
  2. Session transport: the dashboard (Vercel) and API (Railway) are cross-site, so third-party cookies
     will fail in Safari. Recommended: short-lived bearer session token (JWT, 12 h, HS256 with
     SESSION_SECRET, `sub` = checksummed address) returned in the body, sent as Authorization header;
     strict CORS allowlist (CORS_ORIGIN); no cookies → no CSRF surface. State the trade-off.
  3. Trust model for revenue — never trust the proxy's numbers:
     - exact rail: source of truth = USDC Transfer logs on Arc (emitter 0x3600…0000, topic2 `to` ∈ provider
       set). Check with arc-docs whether native-USDC movements also emit Transfer logs from the system
       address 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE and make sure nothing is double-counted or missed.
     - Gateway rail: source of truth = Circle Gateway transfer records (`/v1/x402/transfers` or the SDK's
       searchTransfers by `to` and status). This also closes the Phase 2 gap: a transfer that ends `failed`
       after we served it must show as failed/unpaid.
     - Proxy telemetry adds context only (route, latency, backend status, payer↔request link). An event is
       `verified` only when matched to an on-chain transfer (txHash + to + amount) or a Gateway transfer
       (transfer id + to + amount + status not failed). Revenue totals use verified only; show unverified
       separately.
  4. Indexer: start at block 70918643; chunked getLogs (find the RPC's max range empirically, back off on
     errors); idempotent upserts keyed (txHash, logIndex); Arc has deterministic finality < 1 s — say what
     confirmation depth you use and why. Index ChainPeAccounts events (ProviderRegistered, Service*,
     Subscribed, …) and ERC-8004 ReputationRegistry NewFeedback for registered agentIds. Compare the live
     testnet Reputation ABI with contracts/abis/erc8004/ReputationRegistry.json first (deferred from Phase 4).
  5. agentId staleness (review L-1): reputation is attributed only while IdentityRegistry.ownerOf(agentId)
     == provider; re-check on read with a cache.
  6. Plan gating server-side from planOf (cache 60 s, invalidate on Subscribed); Free = 7-day window,
     1 service, top-5 buyers, average rating only; Pro = everything incl. CSV. Error code `plan_required`.
  7. Data model (Drizzle) and migrations; amounts as numeric/text atomic strings, never JS numbers.
  Show me the note and wait.

F1. Implement services/chainpe-cloud (copy from chainpe-indexer; keep the old one untouched):
  - Routes per spec 08 (auth/nonce, auth/verify, auth/logout, keys CRUD, ingest/events, ingest/heartbeat,
    me, me/services, me/summary, me/payments (+ .csv), me/buyers, me/reputation, me/health, me/wallets).
  - zod validation on every body/query; rate limits per IP and per key; JSON errors {error, message}.
  - Ingest keys `cpk_…` stored as SHA-256 only, shown once, revocable. Events rejected if payTo !=
    key's provider. Idempotent on event id. Never accept or store payment signatures.
  - Workers in the same process (flag to disable): Arc log indexer, Gateway transfer poller (every 30 s
    for providers with recent Gateway events), reconciler that marks events verified/failed.
  - Self-pay: payer == provider or payer ∈ me/wallets → flagged, excluded from revenue.
  - `services/chainpe-cloud/openapi.yaml` describing every endpoint and schema, and
    `services/chainpe-cloud/fixtures/*.json` realistic responses — the Phase 6 Arc Studio dashboard run
    is built from these two, so keep them exact.
F2. CLI (packages/chainpe):
  - `chainpe login`: SIWE signed locally with the seller key → session → create ingest key → save
    cloudUrl + key in ~/.chainpe/config.json (0600). `chainpe logout`.
  - Proxy telemetry per spec 04: batch every 5 s / 50 events, retry with backoff, drop after 24 h, opt-out
    `--no-telemetry`, never send signatures or keys. Heartbeat every 5 min: version, rails, Gateway
    balance, last doctor JSON.
  - Optional CHAINPE_CLOUD_URL in the demo's Railway variables.
F3. Tests (vitest + supertest against a real Postgres — docker locally or a Railway test DB; no pg-mem):
  - SIWE: wrong domain/chain/expired/reused nonce → 401; unregistered address → 403 not_registered.
  - Isolation: provider A's token cannot read B's data on any endpoint (table-driven over all routes).
  - Ingest: wrong payTo → 403; duplicate event id → one row; huge batch → 413.
  - Verification: event + matching Transfer → verified; amount mismatch → unverified; Gateway transfer
    later `failed` → event failed and excluded from revenue.
  - Plans: Free 30d range → plan_required; Pro passes; plan flips after a Subscribed event.
  - Indexer: chunking, restart resumes from last block, no duplicate rows.
F4. Deploy to Railway (service + Postgres). Env: DATABASE_URL, SESSION_SECRET, ARC_RPC_URL,
  CHAINPE_ACCOUNTS_ADDRESS, ACCOUNTS_DEPLOY_BLOCK=70918643, ERC8004_IDENTITY_REGISTRY,
  ERC8004_REPUTATION_REGISTRY, CIRCLE_GATEWAY_URL, CORS_ORIGIN, SIWE_DOMAIN. Tell me the exact
  variables; I set secrets myself.
F5. Live acceptance (Arc testnet, demo seller on Railway):
  - chainpe login from the seller; one paid call per rail from the buyer.
  - GET /v1/me/payments shows both within 5 s; the exact one turns `verified` from the Transfer log; the
    Gateway one turns verified once Circle's transfer record matches (may take minutes; show it).
  - A third wallet (not buyer, not seller) gets 403 not_registered; the buyer's token sees none of the
    seller's data.
  - Append to PROOF.md; tick Phase 5 in BUILD-PLAN.md.

Rules
- Never log, store or transmit private keys, JWT secrets, ingest keys in plaintext, or payment signatures.
- Money is atomic strings/bigint end to end; format only at the edge.
- Do not touch apps/ (Phase 6) or the SDK/wallet/agent (Phase 7).
- If a Circle/Arc API behaves differently from these notes, stop and show me the exact response.
- Stop and ask me at: F0 approval, Railway variables, and anything that needs funds.

Report at the end: E results with links, the approved F0 decisions, endpoints implemented, test output,
deployed API URL, F5 evidence (payment ids, verified states), files changed, commits, open items for
Phase 6 (incl. paths of openapi.yaml and fixtures for the Studio dashboard run).
