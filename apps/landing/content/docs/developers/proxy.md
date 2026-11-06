---
title: Proxy behaviour
description: How the proxy routes, charges and forwards requests, including the edge cases.
---

`chainpe start` runs an Express server in front of your API. This page covers what it does with each request, so nothing surprises you in production.

## Request order

| Order | Path or condition | What happens | Charged? |
|---|---|---|---|
| 1 | `GET /health` | Answered by the proxy | No |
| 2 | `/chainpe-admin/*` | Admin API, see below | No |
| 3 | `/.well-known/x402`, `/openapi.json`, `/.well-known/agent.json` | Answered by the proxy | No |
| 4 | `OPTIONS` on any path | Answered by the proxy with `204`, for CORS. Your API never sees it | No |
| 5 | Anything else | Payment gate, then your API | **Yes** |

**Reserved paths.** Your API's own versions of the paths in rows 1 to 3 can't be reached through the proxy. If your API has its own `/health`, this one takes over.

## Routes and pricing

Specific routes are checked first, then a catch-all at `pricePerRequest`.

```json
{
  "pricePerRequest": "0.01",
  "routes": [
    { "path": "GET /weather", "pricePerRequest": "0.001", "paymentToken": "USDC" },
    { "path": "POST /v1/search", "pricePerRequest": "0.05", "paymentToken": "USDC" },
    { "path": "/any-method", "pricePerRequest": "0.02", "paymentToken": "USDC" }
  ]
}
```

| Request | Price | Offered on |
|---|---|---|
| `GET /weather` | $0.001 | Gateway only, as it's under $0.01 |
| `POST /v1/search` | $0.05 | `exact` and Gateway |
| `GET /any-method` | $0.02 | `exact` and Gateway |
| `POST /weather` | $0.01 (default) | `exact` and Gateway |
| `GET /` or `GET /typo` | $0.01 (default) | `exact` and Gateway |

**Every path is charged, even ones you didn't list.** A buyer who pays for a path your API doesn't have is charged and then gets your 404. To limit this, keep `pricePerRequest` as low as makes sense, and rely on `routes` for your real prices.

A path with no method matches any method. `chainpe init` treats a bare path as `GET`.

The proxy logs its routes at startup. Check them there:

```text
Configured x402 routes:
  GET /weather → $0.001 USDC (gateway)
  * /* → $0.01 USDC (exact, gateway)
```

## What your API receives

- The original method, path, query, headers and body.
- **Not** `PAYMENT-SIGNATURE` or `X-PAYMENT`, which are removed.
- `Host` is rewritten to match `targetUrl`.

Your API gets no header saying who paid. It treats every request as already paid for. Don't use the proxy as your only source of user identity.

## What the buyer receives

| Your API | Buyer sees | Buyer charged? |
|---|---|---|
| Any response | Your status and body, plus `PAYMENT-RESPONSE` | Yes |
| Returns 5xx | Your 5xx | **Yes** |
| Unreachable | `502 {"error":"Bad Gateway",...}` | **Yes** |
| Payment refused | `402 {"error":"payment_failed","reason":...}` | No, and your API isn't called |

There are no refunds, so a failure after settlement costs the buyer. The proxy counts these as `chargedButBackendFailed`. Keep your API reliable, and watch that number.

## Limits

- **HTTP only.** WebSocket upgrades aren't proxied, because they would skip the payment gate.
- **State is in memory.** Stats, pending payments and duplicate tracking reset on restart. Don't run several instances behind one load balancer and expect them to share duplicate tracking.
- **No rate limiting.** Unpaid requests cost you nothing but a 402. Add limits at your host if you need them.
- **CORS is open**, so browser agents can pay. It exposes the three payment headers.

## Public URL and TLS

Behind a TLS-terminating proxy, the server sees an internal address. Set `publicUrl` so `resource.url` in the 402 is the address buyers actually use. Without it, the proxy trusts one upstream hop for the scheme.

`chainpe identity` and `chainpe register` refuse a `publicUrl` that:

- isn't HTTPS (`--allow-http` works on testnet only)
- contains a username, password, query or fragment, because it's published on-chain
- is a private address, because buyers can't reach it
- is the same as `targetUrl`, because buyers could then skip payment

## Admin API

Read-only endpoints for you, which include payer addresses:

| Endpoint | Returns |
|---|---|
| `GET /chainpe-admin/stats` | Requests, payments, failures, revenue and recent payments |
| `GET /chainpe-admin/payments` | Recent payments |
| `GET /chainpe-admin/config` | Your public settings |
| `GET /chainpe-admin/schema` | Your API's `/schema`, if it has one |

They need either a request from the same machine, or an `adminKey` in the config sent as `X-Admin-Key`. A request that came through a tunnel or a browser doesn't count as local.

```bash
curl localhost:4402/chainpe-admin/stats
```

```json
{
  "totalRequests": 9,
  "paidRequests": 0,
  "failedPayments": 0,
  "chargedButBackendFailed": 0,
  "lastHourRequests": 9
}
```

## Telemetry

After `chainpe login`, the proxy reports each payment to `chainpe-cloud`, so the dashboard can verify it.

- **Sent:** id, time, route, method, rail, network, amount, payer, payee, status, latency, your API's status code, and any error. Signatures and request bodies never leave the proxy.
- **When:** batched every 2 seconds, or at 50 events, with a heartbeat every 5 minutes.
- **If the cloud is down:** events queue and retry with backoff, and are dropped after 24 hours. A paid request is never slowed or failed by this.
- **To turn it off:** `--no-telemetry`, or simply don't log in. You then get no verified revenue in the dashboard.

## When to restart

The proxy reads the config once, at startup. Restart after you:

- edit the config
- run `chainpe identity` or `chainpe login`

You don't need to restart after `chainpe doctor`. The discovery documents are read from disk on each request.
