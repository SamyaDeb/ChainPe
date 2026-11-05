You are a senior x402 / EVM payments engineer continuing the ChainPe → Arc port. Phase 1 is done and
was reviewed. Your job now: (A) close the review findings from Phase 1, then (B) build Phase 2 — Circle
Gateway nanopayments as a second rail next to `exact`. Correctness of money flow beats speed: no buyer
is ever charged without being served, and no backend call ever happens without a final settlement.

Read first: CLAUDE.md, docs/arc/BUILD-PLAN.md (Phase 2), docs/arc/specs/03-gateway-nanopayments.md,
docs/arc/specs/04-cli-proxy-arc.md, and the Phase 1 code: packages/chainpe/src/proxy/server.ts,
proxy/circleFacilitator.ts (SettlementGuard), proxy/routeConfig.ts, src/chains.ts, commands/consume.ts,
and packages/chainpe/__tests__/*. Use the arc-docs MCP for Arc facts. Read the installed SDK sources
in node_modules/@circle-fin/x402-batching (README, dist/*.d.ts) and node_modules/@x402/core before
designing — do not guess APIs.

State of the code (verified)
- Branch `arc`, 8 commits. CLI is Arc-only (`arc`, `arc-testnet`); Avalanche removed from the CLI on purpose.
- x402 v2 (@x402/core|evm|express|fetch 2.30), routes use `extra.paymentFlow: "upfront"` so settle
  happens before next(). Exact settles through CircleFacilitatorClient (keyless) wrapped in SettlementGuard
  (payment-identifier, pending polling 500 ms / 20 s, duplicate-delivery guard, registration_required mapping).
- Live test passed on Arc testnet; Circle rejects a replayed completed payment with invalid_transaction_state.
- `tsc --noEmit` passes. Registry commands exit with a notice until Phase 4.

PART A — Phase 1 review findings (fix first, one commit each, prefix `arc:`)
A1. Commit the planning docs that are still untracked: CLAUDE.md and docs/arc/ (commit as-is).
A2. Paid-but-not-served gap (Medium). If settlement is still pending after the 20 s poll, the guard
    returns pending and deletes the id; if Circle later completes it, a retry with the same signed
    payment re-settles, Circle answers invalid_transaction_state, and the buyer has paid without being
    served. Fix: keep a bounded `pending` map id → { paymentId, network, firstSeen } (TTL 1 h). On a retry
    of a known pending id, do NOT call settle again — poll getStatus(paymentId); completed → deliver
    (mark delivered), failed → fail, still pending → 402 settlement_pending with paymentId. Also on any
    settle error whose reason is invalid_transaction_state for an id we have as pending, resolve via
    getStatus. Add tests for: timeout-then-complete-then-retry delivers exactly once; timeout-then-fail.
A3. Admin data exposure (Low/Medium). /chainpe-admin/payments and /stats expose payer addresses to anyone
    when no adminKey is set. Make the admin router require `adminKey` OR a loopback remote address
    (127.0.0.1 / ::1); otherwise 401. /health stays public. Test both cases.
A4. Backend failure after upfront settlement (document, don't change behaviour now): the buyer is charged
    even if the backend returns 5xx. Record `backendStatus` (already in PaymentEvent) and add a counter
    `chargedButBackendFailed` to /chainpe-admin/stats. Add a "Known limitations" line in
    docs/arc/specs/04-cli-proxy-arc.md.
A5. .env.example: remove the stale Fuji/Railway CHAINPE_FACILITATOR_URL block; add the Gateway vars below.
A6. packages/chainpe/package.json: the CLI is now Arc-only and breaks Avalanche users of 2.0.1 — bump to
    3.0.0-arc.0 (prerelease, do not publish) and note the breaking change in the package README.

PART B — Phase 2: Gateway nanopayments rail

Facts from @circle-fin/x402-batching 4.0.0 (verify in node_modules before relying on them):
- Gateway uses x402 scheme "exact" with `extra.name: "GatewayWalletBatched"` (CIRCLE_BATCHING_NAME),
  versions "1"/"2". Same scheme + network as plain exact → routing must be by `extra.name`, not by scheme.
- Server: BatchFacilitatorClient (default url https://gateway-api.circle.com; testnet
  https://gateway-api-testnet.circle.com), GatewayEvmScheme, createGatewayMiddleware, and
  isBatchPayment-style detection. Circle's documented pattern:
    new x402ResourceServer([standardFacilitator, new BatchFacilitatorClient()])
      .register("eip155:*", new GatewayEvmScheme())
- Client: GatewayClient({ chain: "arcTestnet" | "arc", privateKey }) with deposit(amount), pay(url),
  getBalances() → { gateway: { formattedAvailable, formattedTotal } }, withdraw(amount, { chain? });
  CompositeEvmScheme picks Gateway vs plain exact by extra.name.

B1. Design spike (no production code yet). Write docs/arc/specs/03a-gateway-design.md answering, from the
    SDK source: (1) how x402ResourceServer chooses a facilitator when two clients both support
    "exact" on eip155:5042002; (2) whether GatewayEvmScheme alone serves BOTH plain exact and batched
    requirements, or ExactEvmScheme + GatewayEvmScheme must coexist, and how; (3) whether the Gateway
    path supports `paymentFlow: "upfront"` (settle before handler) and what Gateway "settle" means
    (instant acceptance against the buyer's deposit vs on-chain batch later) — we must only forward after
    Gateway confirms the payment is accepted/settled; (4) whether Gateway settle can return pending.
    If the resource server cannot route by extra.name, design a `RailRouter implements FacilitatorClient`
    that dispatches verify/settle by `requirements.extra?.name === "GatewayWalletBatched"` to
    BatchFacilitatorClient and everything else to SettlementGuard, and merges getSupported().
    Show me the design and STOP for my approval before B2.
B2. Implement per the approved design:
    - routeConfig: each route's `accepts` lists the enabled rails with the same payTo and price:
      exact (Circle facilitator) and Gateway (extra filled from Gateway getSupported, incl.
      verifyingContract). Both keep paymentFlow "upfront" if B1 confirmed it works for Gateway.
    - Config `rails: ("exact" | "gateway")[]`, default ["exact","gateway"]; CLI `--rails exact,gateway`.
      If a route price < $0.01, drop the exact option for that route and log a warning once.
    - Env: CIRCLE_GATEWAY_URL (default by network: testnet URL for arc-testnet, SDK default for arc).
    - PaymentEvent.rail = "gateway" for batched payments, with Gateway's payment/settlement id in
      paymentId and txHash only if one exists. /chainpe-admin/stats revenueByRail shows both.
    - SettlementGuard-equivalent guarantees for the Gateway rail: idempotency, no double delivery,
      no forward on non-final results.
B3. Seller money commands (seller key stays local, never logged):
    - `chainpe balance` → seller Gateway available/total + on-chain ERC-20 USDC (6 dp).
    - `chainpe withdraw <amount> [--chain <name>]` → GatewayClient.withdraw; print tx + explorer link.
B4. Buyer test helpers in commands/consume.ts:
    - `chainpe deposit <amount>` → buyer GatewayClient.deposit (CHAINPE_PRIVATE_KEY).
    - `chainpe fetch <url> --rail gateway|exact|auto` → auto prefers Gateway when the buyer has a
      Gateway balance ≥ price, else exact; enforce --max before signing.

Tests (run them, show output)
- Unit: 402 for a $0.01 route lists two options (one plain exact on eip155:5042002, one with
  extra.name GatewayWalletBatched); a $0.001 route lists only Gateway; rails ["exact"] lists one.
- Unit: RailRouter (or SDK routing) sends batched payloads to the batch client and plain ones to the guard.
- Unit: Gateway non-final / failed / unreachable → backend gets zero requests; replay → one delivery.
- Live on Arc testnet (I funded the buyer at faucet.circle.com):
  chainpe deposit 1.00
  chainpe start --network arc-testnet    (examples/weather-api behind it, routes at $0.001 and $0.01)
  chainpe fetch <$0.001 route> --rail gateway   → 200
  chainpe fetch <$0.01 route> --rail exact      → 200 + tx link
  chainpe balance                               → Gateway available increased
  chainpe withdraw 0.001                        → tx link
- npm test and tsc --noEmit green. (Note: build/tests run on my Mac; native rollup is darwin.)

Rules
- packages/chainpe only (plus docs). No SDK / wallet / agent changes (Phase 7).
- Never log or persist keys outside .env. Never print full payment signatures.
- If the SDK behaves differently from the facts above, stop and report the exact difference with file
  and line from node_modules before working around it.

Report at the end: findings fixed (A1–A6), the B1 design decision, files changed, commits, test output,
the Gateway payment id and the exact-rail tx hash with explorer links, and open items for Phase 3.
