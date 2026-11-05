# Spec 04 — `chainpe start --network arc`

**Goal:** one command puts any HTTP API behind x402 v2 on Arc, accepting both rails, and forwards a
request to the backend **only after settlement completes**.

## Command surface (changes in `packages/chainpe/src/cli.ts`)

| Command | Change |
|---|---|
| `chainpe init` | add `--network`; ask rails (default both on `arc*`); store seller key in keychain; check signer == payout wallet |
| `chainpe start` | `-n, --network <arc\|arc-testnet\|avalanche\|fuji>`; `--rails exact,gateway`; `--no-telemetry`; `--facilitator-url` (advanced) |
| `chainpe login` | NEW — wallet-signed login to chainpe-cloud; saves `cloudUrl` + ingest key (spec 08) |
| `chainpe register` / `deregister` / `list` | `arc*` → `ChainPeAccounts` (spec 06); avalanche/fuji → existing registry |
| `chainpe identity` | NEW — spec 10 |
| `chainpe doctor` | NEW — spec 05 |
| `chainpe balance` / `withdraw` | NEW — spec 03 |
| `chainpe fetch` / `discover` | buyer helpers on Arc (spec 09) |

Default port stays `4402`.

## Request pipeline (`packages/chainpe/src/proxy/server.ts`)

1. Free paths pass through without payment: `/.well-known/x402`, `/openapi.json`, `/chainpe-admin/*`, `OPTIONS`.
2. Paid path, no payment header → 402 with `PAYMENT-REQUIRED` listing enabled rails (spec 03).
3. Payment header present → verify → **settle before handler** → on `success: true` forward to `targetUrl`;
   on pending → poll status (spec 02); on failure → 402 with reason. Backend never sees payment headers.
4. Response to buyer includes `PAYMENT-RESPONSE` (tx hash or Gateway payment id).
5. `afterSettle` hook records a `PaymentEvent` locally (existing `proxy/analytics.ts`) and queues it for telemetry.

How to get settle-before-handler with x402 v2: the core supports payment flows with
`settleBeforeHandler` (`PaymentFlowName` `"upfront"`) and `x402HTTPResourceServer.processSettlement(..., phase: "before-handler")`.
**VERIFY** that `ExactEvmScheme` and `GatewayEvmScheme` accept `extra.paymentFlow: "upfront"`; if not,
call `processHTTPRequest` then `processSettlement` manually before `createProxyMiddleware` forwards.
Do not use plain `paymentMiddleware` + proxy, because it settles after the handler.

## Local analytics + telemetry

`PaymentEvent` (extend existing type):

```ts
{ id: string; ts: number; route: string; method: string; rail: 'exact' | 'gateway';
  network: string; amountAtomic: string; payer: string; payTo: string;
  txHash?: string; paymentId?: string; status: 'completed' | 'failed' | 'pending';
  latencyMs: number; backendStatus?: number }
```

Telemetry: batch POST to `${cloudUrl}/v1/ingest/events` every 5 s or 50 events, `Authorization: Bearer <ingest key>`;
retry with backoff; drop after 24 h. Off with `--no-telemetry` or no ingest key.

## Stretch: MCP tools

If `targetUrl` is an MCP server (`/mcp`), price per tool from `routes.json` (`"mcp:<toolName>": "0.002"`),
answer `initialize`/`tools/list` free, and add `_meta.x402.price_usd` to each tool in `tools/list`.

## Acceptance

- [ ] `chainpe start --network arc-testnet` in front of `examples/weather-api` → unpaid 402, paid 200.
- [ ] Backend request log shows **zero** calls for failed/pending payments (test with a mocked facilitator).
- [ ] `/chainpe-admin/stats` shows revenue split by rail.
- [ ] `--no-telemetry` sends nothing (network spy test).
