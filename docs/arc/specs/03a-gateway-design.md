# Spec 03a — Gateway rail design (B1 spike)

**Status:** approved and implemented. Live results are at the end.

Evidence is one of: **source** (read in `node_modules`, `file:line`), **ran** (executed during the spike),
**docs** (Circle's Gateway docs), or **unknown** (could not be established without a funded payment).

Versions: `@circle-fin/x402-batching` 4.0.0, `@x402/core` / `@x402/evm` 2.30.0.
Paths below are relative to `node_modules/`.

## Decision

Spec 03's wiring does not work. Use **one `RailRouter` as the only facilitator** and **only
`ExactEvmScheme` as the scheme server**. `routeConfig` fills in the Gateway `extra` itself, from Gateway's
`/v1/x402/supported` at startup.

```ts
const router = new RailRouter({ exact: settlementGuard, gateway: gatewayGuard });
new x402ResourceServer(router).register(caip2, new ExactEvmScheme());
```

## Q1. How does the resource server choose between two facilitators?

By `(x402Version, network, scheme)`, first one wins. `extra.name` plays no part.

- `@x402/core/dist/esm/chunk-U5TAZTKB.mjs:1055-1057` stores a client only if that key is still empty.
- `:2179` `getFacilitatorClient(version, network, scheme)` is the only lookup, for verify and settle.
- `:1090` `getSupportedKind` also returns just the first kind for that key.

Both Circle services publish `exact` on `eip155:5042002` (ran: live `/supported` on both), so the second
client can never be reached for Arc.

## Q2. One scheme or two?

They cannot coexist. `register` keeps one server per scheme name (`:803`), and both are named `exact`.
Registering the second on `eip155:*` does not help, because an exact network match wins and the wildcard
is never consulted for Arc (`@x402/core/dist/esm/chunk-XW2CWVLZ.mjs:69-80`).

`GatewayEvmScheme` alone is wrong too. It overwrites route `extra` with `supportedKind.extra`
(`@circle-fin/x402-batching/dist/server/index.mjs:1561`) and forces a 7-day timeout on every option (`:1514`).

`ExactEvmScheme` alone serves both. Its `enhancePaymentRequirements` is a no-op
(`@x402/evm/dist/esm/exact/server/index.mjs:95`), and route `extra` overrides the parsed price's
`extra` (`chunk-U5TAZTKB.mjs:1156`).

Ran in-process with stub facilitators, a batched payment against each wiring:

| Wiring | 402 option 1 (exact) | 402 option 2 (Gateway) | Batched payment went to |
|---|---|---|---|
| A. Spec 03: `[circle, gateway]`, exact + gateway schemes | correct | correct | **circle** (wrong) |
| B. `[circle, gateway]`, GatewayEvmScheme | 7-day timeout (wrong) | renamed `USDC` (wrong) | **circle** (wrong) |
| C. `[gateway, circle]`, GatewayEvmScheme | renamed Gateway (wrong) | correct | gateway |
| **D. `[router]`, ExactEvmScheme** | **correct** | **correct** | **gateway** |

## Q3. Does Gateway work with `paymentFlow: "upfront"`, and what does settle mean?

**Upfront works.**

- `ExactEvmScheme` allows it for eip3009 (`exact/server/index.mjs:13-16`), and D above produced it.
- Gateway tolerates it: with `extra.paymentFlow` present, `/verify` returned `isValid: true` and `/settle`
  went on to the balance check (ran, unfunded throwaway key).
- Circle's own middleware also settles before the handler
  (`x402-batching/dist/server/index.mjs:1276`).

**`verify` proves nothing about funds.** It returned `isValid: true` for a wallet with a zero balance
(ran); `settle` then answered `insufficient_balance`. `upfront` skips verify (`chunk-U5TAZTKB.mjs:1349`),
which is the right behaviour here: settle is the only real check.

**Settle means accepted, not on-chain.** Circle's settle reference: "the authorization will be verified,
the sender's balance locked, and the transaction queued for batch processing". The concept page: Gateway
"locks the buyer's funds, and credits the seller's pending balance. The seller serves the resource
immediately". The reconciliation page: a completed request "confirms only that the payment was accepted,
not that it settled".

Measured on the 100 most recent public Arc testnet transfers (ran): 74 `completed`, 26 `received`, 0
`failed`; time to the last update on completed ones was median 467 s, max 894 s. This is one sample.

## Q4. Can Gateway settle return pending?

No (docs). The settle response has no pending state and `errorReason` has no pending value. `success: true`
with a transfer UUID in `transaction` means accepted; the batch status lives on the transfer record
(`received`, `batched`, `confirmed`, `completed`, `failed`), not in the settle response.

Failures arrive as HTTP 200 with `success: false` (ran), so they do not throw. Network errors, 5xx and
non-JSON bodies do throw (`dist/server/index.mjs:200-227`).

**Unknown:** whether a transfer can reach `failed` after a successful settle. Circle says "transfers that
end in `failed` were never charged" but does not explain how one gets there.

## Differences from the brief

| Brief | Actual | Where |
|---|---|---|
| Documented pattern `new x402ResourceServer([standard, new BatchFacilitatorClient()])` | The README shows `[new BatchFacilitatorClient()]` alone. The two-client form routes batched payments to the first client. | `x402-batching/README.md:51`, table above |
| `balance` shows Gateway available increased | `available` rises only "after the batch settles onchain" (docs); median about 8 min in the sample | Q3 |
| `txHash only if one exists` | `transaction` is a UUID, never a hash. The hash appears later on the transfer record (74 of 74 completed had one) | ran |
| `CIRCLE_GATEWAY_URL` | Server side only. `GatewayClient` hardcodes its API URLs | `dist/client/index.mjs:682-683` |
| `GatewayClient` defaults | Default testnet RPC is `rpc.testnet.arc.network`, not ours. We pass `rpcUrl` from `chains.ts` | `dist/client/index.mjs:104` |
| `withdraw` prints tx | Result field is `mintTxHash`. The seller pays mint gas from the wallet; the fee is deducted on Gateway and its size is undocumented | `dist/client/index.mjs:1454` |

## Components

### `proxy/railRouter.ts`: `RailRouter implements FacilitatorClient`

- `verify` / `settle`: `isBatchPayment(requirements)` selects `gateway`, anything else goes to `exact`.
  `requirements` is the server's matched option, not buyer input, so a buyer cannot pick a rail the route
  did not offer (`paymentRequirementsMatchAccepted`, `chunk-U5TAZTKB.mjs:2237`).
- `getSupported`: merges `kinds`, `extensions` and `signers` of the enabled rails.
- A batched payment with the Gateway rail disabled fails closed with `rail_not_enabled`.

### `proxy/gateway.ts`: `GatewayGuard implements FacilitatorClient`

Same guarantees as `SettlementGuard`, keyed by the same `paymentIdentifierFor`.

| Situation | Result | Backend |
|---|---|---|
| Duplicate while settling | `payment_in_progress` | no |
| Already delivered | `payment_already_used` | no |
| `success: true`, non-empty `transaction` | deliver, mark delivered | **once** |
| `success: true`, empty `transaction` | `gateway_not_final` | no |
| `success: false` (any reason, including `settlement_pending`) | passed through | no |
| Throw, 5xx, bad JSON | `gateway_unavailable`, id kept as *uncertain* | no |
| Retry of an uncertain id, `success: true` | deliver | once |
| Retry of an uncertain id, `nonce_already_used` | look up the transfer, see below | once at most |
| `nonce_already_used`, id not uncertain | refused | no |

**Lost responses** are the Gateway form of the A2 bug: Gateway accepts the payment, the response is lost,
and the retry gets `nonce_already_used`. Only for ids we saw fail that way, the guard calls
`GET /v1/x402/transfers?nonce=…&network=…` (public; filter confirmed by running it) and delivers only if a
row matches nonce, from, to and amount and is not `failed`. All four are compared because nonces are not
globally unique (ran: an all-zero nonce returned two rows). Uncertain ids are bounded, with a 1 h TTL.

Doing this lookup for every `nonce_already_used` would be wrong: after a restart, a replay of a delivered
payment would find its transfer and get a free backend call.

### `routeConfig`, config and CLI

- `accepts` lists **exact first**. Stock x402 clients take the first option they can sign, and signing a
  Gateway option with plain `exact` fails.
- The Gateway option carries `{ name, version, verifyingContract, paymentFlow: "upfront" }` and
  `maxTimeoutSeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS`. `version` is the lowest in
  `authorizationVersions` for USDC, matching the SDK, so older buyers can pay.
- Prices are compared as integers (`parseUnits(price, 6) < 10_000n`), never floats.
- `rails` in config, default `["exact","gateway"]`; `--rails exact,gateway`; `CIRCLE_GATEWAY_URL`.
- New `routes?: RouteConfig[]` in `ChainPeConfig`: the CLI has no way to set per-route prices today, and the
  live test needs `$0.001` and `$0.01` routes.

### Events, money commands, buyer

- `toPaymentEvent`: `rail` from `isBatchPayment(payload.accepted)`; for Gateway `paymentId = transaction`
  and `txHash` stays unset. `chainpe fetch` prints an explorer link only for real hashes.
- `balance`, `withdraw`, `deposit` per B3 and B4, passing `rpcUrl`. `balance` also shows seller
  **pending** from `searchTransfers({ to, status })`, otherwise a just-paid seller sees no change.
- `fetch --rail`: an x402 policy filters `accepts` by `isBatchPayment`, on `CompositeEvmScheme`. `auto` reads
  the Gateway balance first. `--max` stays in `spendControls`, which run before policies, so before signing.

## Decisions (all approved as recommended)

1. **Forward on Gateway `success: true`?** Recommended: yes. Funds are locked and Circle's flow serves at this
   point; waiting for `completed` would hold each request for minutes. This **conflicts with CLAUDE.md**
   ("never forward … before settlement is `completed`"), so that line needs a Gateway exception. Residual
   risk falls on the seller, not the buyer: if a transfer later ends `failed`, the seller served for free.
2. **`--rails exact` with a route under $0.01 leaves no option.** Recommended: refuse to start, naming the route.
3. **Gateway unreachable at `chainpe start`.** Recommended: refuse to start and suggest `--rails exact`,
   rather than silently dropping a rail that sub-cent routes depend on.
4. **Live test timing.** `balance` will show the increase only after the batch, so the run waits up to about
   15 min. `withdraw 0.001` may fail: the seller's only Gateway revenue in the test is $0.001, and the fee is
   undocumented. If it does, the options are more paid calls or a seller deposit; I would stop and report.

## Known limits of this design

- Replay state is in memory. After a restart, Gateway's nonce check still blocks a replay, but an uncertain
  id is forgotten and that buyer's retry is refused.
- Retries protect only a re-send of the **same signature**. `chainpe fetch` signs anew on each run, so
  re-running it after a lost response can pay twice, on both rails. Fix belongs in the buyer SDK (Phase 7).
- Serving before the batch lands needs reconciliation to catch a late `failed` transfer. Not in this phase.

## Live results (Arc testnet)

| Check | Result |
|---|---|
| `deposit 1.00` | `0x5c05705f9945fba7815d3511c9f717a0922dee8f534f076e4ffcbb8a8fcacb81` |
| `fetch` $0.001, `--rail gateway` | 200, transfer `393435a2-78e7-45c3-bfd8-9f85d7b87930` |
| `fetch` $0.01, `--rail exact` | 200, tx `0x11027eae23b4efd8419e7fdfae073622d6096efb0767882d30a71080df83c6c9` |
| Batch for that transfer | `completed` in about 35 s, tx `0xccffd62c1f3dc573deb7cff643d62560043da11794da8875ce03af4951691ab6` |
| `balance` | available 0 → 0.001, pending shown before it landed |
| Replay, same process | 402 `payment_already_used` |
| Replay after a proxy restart | 402 `nonce_already_used`, from Gateway; backend not called |
| `--max` below the price | refused before signing |
| `auto` on a funded buyer | paid through Gateway |
| `withdraw 0.001` | **failed**: "available 0.001000, required 0.0045" |

**Withdrawal fee.** Gateway required 0.0045 to withdraw 0.001, so the fee on this same-chain withdrawal was
0.0035 USDC. It is charged on top of the amount, so `available` must cover both. One observation on testnet;
the mainnet fee may differ. `withdraw` has not yet completed on-chain.
