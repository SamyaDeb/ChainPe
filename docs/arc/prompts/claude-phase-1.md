Implement Phase 1 of the ChainPe → Arc port: a real paid call on Arc testnet through Circle's
Facilitator Service, keyless (no CIRCLE_API_KEY). Read CLAUDE.md, docs/arc/BUILD-PLAN.md (Phase 1),
and specs 01, 02 and 04 in docs/arc/specs/ before writing code. Use the arc-docs MCP to check Arc facts.

Context
- Work on branch `arc` (create it if missing). Small commits, prefix `arc:`, one per step below.
- Keyless mode: Circle settles `exact` payments with only a seller-proof signed by the payout key.
  Use `CircleFacilitatorClient` from `@circle-fin/x402-batching/server` (v4.0.x) with `sellerSigner`
  and no apiKey. Do not hand-roll the seller proof.
- Env (I will put these in .env, never commit or print them):
  CHAINPE_SELLER_PRIVATE_KEY = payout wallet key (its address must equal walletAddress / payTo)
  CHAINPE_PRIVATE_KEY = buyer key (funded with Arc testnet USDC from faucet.circle.com)
  CHAINPE_NETWORK = arc-testnet
- Arc testnet: chainId 5042002, CAIP-2 eip155:5042002, RPC https://rpc.testnet.arc.io,
  explorer https://explorer.testnet.arc.io, USDC 0x3600000000000000000000000000000000000000
  (ERC-20, 6 decimals; native gas token is the same USDC with 18 decimals).
- Avalanche (`avalanche`, `fuji`) must keep working. Do not delete them.

Steps
1. Networks (spec 01 §1–2): add `arc-testnet` and `arc` to packages/chainpe/src/chains.ts and types.ts
   with chainId, caip2, rpcUrl (env override ARC_TESTNET_RPC_URL / ARC_RPC_URL), usdc, explorer,
   gasToken ('AVAX' | 'USDC'). Define viem chains with defineChain if viem/chains has no Arc export.
   `fromX402Network` must accept CAIP-2 and legacy names. Replace AVAX-specific gas labels/thresholds
   with gasToken-aware code. Add unit tests from spec 01 "Acceptance".
2. x402 v2 in the CLI only (spec 01 §3): in packages/chainpe swap x402 / x402-express / x402-fetch 1.2.0
   for @x402/core, @x402/evm, @x402/express, @x402/fetch 2.30.x and add @circle-fin/x402-batching ^4.0.0.
   Update routeConfig.ts to v2 routes ({ "METHOD /path": { accepts: [{ scheme: 'exact', price, network:
   caip2, payTo }], description } }) and headers (PAYMENT-REQUIRED, PAYMENT-SIGNATURE, PAYMENT-RESPONSE).
   Bump engines to node >= 22.18 for this package.
3. Circle facilitator (spec 02): new packages/chainpe/src/proxy/circleFacilitator.ts. Refuse to start if
   the signer address != walletAddress. For arc* networks use it; keep the existing local/hosted
   facilitator path for avalanche/fuji. Map 403 registration_required to:
   "Circle keyless trial used up for this payout wallet — set CIRCLE_API_KEY".
   Handle settlement_pending: poll getStatus every 500 ms up to 20 s; never forward on pending.
   Send a payment-identifier (16–128 chars [A-Za-z0-9_-]) derived from the request on every settle.
4. Settle BEFORE forwarding (spec 04 "Request pipeline"): the default @x402/express paymentMiddleware
   settles after the handler, which is wrong for a proxy. First check whether ExactEvmScheme supports
   the "upfront" payment flow (settleBeforeHandler) in @x402/core 2.30. If yes, use it; if not, use
   x402HTTPResourceServer.processHTTPRequest + processSettlement (phase "before-handler") yourself and
   only then call the http-proxy-middleware forward. Tell me which way you chose and why.
   Free paths (no payment): /chainpe-admin/*, /.well-known/x402, /openapi.json, OPTIONS.
5. CLI flags: `chainpe start -n, --network <arc|arc-testnet|avalanche|fuji>`; `chainpe status` prints
   network, chainId, caip2, gas token, payTo, facilitator mode (circle-keyless / circle-key / local).
   Update `chainpe fetch` to pay on Arc with @x402/fetch v2 + ExactEvmScheme(account).
6. Analytics: record rail, network, txHash in PaymentEvent (spec 04) and show them in /chainpe-admin/stats.

Test (run these yourself and show me the output)
- npm run build && npm test  (all green)
- Start examples/weather-api, then:
  node packages/chainpe/dist/cli.js start --network arc-testnet
  curl -i http://localhost:4402/<a paid route>   → 402 with an eip155:5042002 exact option
  node packages/chainpe/dist/cli.js fetch http://localhost:4402/<route> --network arc-testnet --max 0.05
  → 200, and print the tx hash + https://explorer.testnet.arc.io/tx/<hash>
- Add a test with a mocked facilitator returning settlement_pending and then failed: the backend must
  receive zero requests.
- Run the existing fuji path once to prove Avalanche still works (skip only if no fuji funds; say so).

Rules
- Do not touch packages other than packages/chainpe in this phase (SDK, wallet, agent come in Phase 7),
  except shared type files if the build needs it.
- Never log keys, never write them to files other than .env, never send them to Arc Studio.
- If something in the specs is wrong or a package API differs from the docs, stop and tell me the
  exact difference before working around it.

When done, report: what changed (files), the commits, test results, the Arc testnet tx hash and
explorer link, which settle-before-forward approach you used, and anything left for Phase 2.
