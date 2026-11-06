---
title: Cloud API
description: Build on the dashboard API, with auth, money rules, verification and limits.
---

`chainpe-cloud` is the API behind the dashboard: wallet sign-in, proxy reports, Arc indexing and verified revenue. It holds no private keys. Use it to pull your own revenue into your own tools.

**Base URL:** `https://chainpe-cloud-production.up.railway.app` (Arc testnet)

**Full spec:** [`openapi.yaml`](https://github.com/SamyaDeb/ChainPe/blob/arc/services/chainpe-cloud/openapi.yaml), with real sample responses in [`fixtures`](https://github.com/SamyaDeb/ChainPe/tree/arc/services/chainpe-cloud/fixtures).

## Three rules

1. **Money is a string.** Every `*Atomic` field is atomic USDC with 6 decimals, like `"11000"` for $0.011. Parse it as a big integer, never a float.
2. **Only `verified` counts as revenue.** Events from a proxy are claims. See [verification](#verification).
3. **On-chain strings are untrusted.** Names, descriptions and endpoints were written by whoever registered them. Show them as text.

## Sign in

Sign-in uses Sign-In with Ethereum (EIP-4361), with a wallet that has a [provider account](/docs/reference/chainpe-accounts).

```ts
import { privateKeyToAccount } from 'viem/accounts'

const API = 'https://chainpe-cloud-production.up.railway.app'
const account = privateKeyToAccount(process.env.CHAINPE_SELLER_PRIVATE_KEY as `0x${string}`)

const post = (path: string, body: unknown) =>
  fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

// 1. Get a message to sign. It's valid for 5 minutes and works once.
const { message } = await post('/v1/auth/nonce', { address: account.address, client: 'cli' })

// 2. Sign it unchanged, and swap it for a token.
const signature = await account.signMessage({ message })
const { token } = await post('/v1/auth/verify', { message, signature })

// 3. Use the token. It lasts 12 hours.
const summary = await fetch(`${API}/v1/me/summary?range=7d`, {
  headers: { authorization: `Bearer ${token}` },
}).then((r) => r.json())
```

Use `client: 'cli'` from a script and `client: 'dashboard'` from a browser. Each signs for a different domain.

| Endpoint | Body or auth | Result |
|---|---|---|
| `POST /v1/auth/nonce` | `{ address, client? }` | `{ nonce, message, expiresAt }` |
| `POST /v1/auth/verify` | `{ message, signature }` | `{ token, tokenType, address, expiresAt }` |
| `POST /v1/auth/logout` | Token | Ends the session |

## Read your data

All of these need the token, and only return your own data. The server enforces your plan, and returns `403 plan_required` for anything Pro-only.

| Endpoint | Returns | On Free |
|---|---|---|
| `GET /v1/me` | Address, agent id, plan, `paidUntil` | |
| `GET /v1/me/services` | Services, last heartbeat, doctor result | Oldest active one only |
| `GET /v1/me/summary?range=` | Revenue, calls and buyers over time | `24h` and `7d` only |
| `GET /v1/me/payments` | Payments, newest first | Last 7 days |
| `GET /v1/me/payments.csv` | CSV export | Pro only |
| `GET /v1/me/buyers` | Payers by verified spend | Top 5, `24h` or `7d` |
| `GET /v1/me/reputation` | Ratings | Averages only, with `items: null` |
| `GET /v1/me/health` | Doctor reports | Latest only |
| `GET /v1/me/fees` | Your usage fee status | Open on both plans |
| `GET`, `PUT /v1/me/wallets` | Your other wallets, up to 50 | |

`range` is `24h`, `7d`, `30d`, `90d` or `all`. `payments` also takes `cursor`, `limit` (up to 100, default 50), `rail` and `route`.

### Reading a summary

```json
{
  "range": "7d",
  "since": "2026-10-30T03:51:15.178Z",
  "revenue": {
    "totalVerifiedAtomic": "11000",
    "exactAtomic": "10000",
    "gateway": { "settledAtomic": "1000", "pendingBatchAtomic": "0" }
  },
  "notRevenue": {
    "unverifiedAtomic": "0",
    "failedAtomic": "0",
    "selfPayAtomic": "0",
    "unattributedInflowAtomic": "0"
  },
  "calls": { "total": 3, "completed": 2, "failed": 1, "verified": 2, "successRate": 0.667 },
  "uniqueBuyers": 2
}
```

| Field | Treat it as |
|---|---|
| `revenue.*` | Real money, verified, excluding your own wallets |
| `gateway.pendingBatchAtomic` | Accepted, but the batch can still fail. Label it pending |
| `notRevenue.*` | Show apart from revenue. Never add it in |
| `failedAtomic` | Calls you served, and weren't paid for |
| `selfPayAtomic` | Payments from your own wallets |

## Verification

Each payment has a `verification` state:

| State | Meaning |
|---|---|
| `verified` | Matched to a USDC transfer on Arc, or to a Circle transfer that hasn't failed |
| `unverified` | Not matched, with the cause in `verificationReason` |
| `failed` | Circle's transfer failed. You served the call and weren't paid |

`verificationReason` is one of `no_transfer_yet`, `not_completed`, `no_tx_hash`, `no_transfer_id`, `amount_mismatch`, `payer_mismatch`, `recipient_mismatch`, `asset_mismatch`, `already_claimed` or `gateway_failed`.

`verified` proves money from that payer reached you. It doesn't prove the payer is an independent customer. For a payment's time, use `effectiveTs`, which comes from the chain or Circle. `ts` is what the proxy reported.

## Reporting payments

The proxy does this for you after `chainpe login`. You only need it if you're writing your own proxy.

These use an ingest key, as `Authorization: Bearer cpk_…`. Create one with `POST /v1/keys`. The full key is shown once.

```bash
curl -X POST "$API/v1/ingest/events" \
  -H "Authorization: Bearer $CHAINPE_INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "id": "chainpe_000000000000000000000000000000000000000000000001",
      "ts": 1793950000000,
      "route": "/forecast",
      "method": "GET",
      "rail": "exact",
      "network": "eip155:5042002",
      "amountAtomic": "10000",
      "payer": "0xBuyer",
      "payTo": "0xYourWallet",
      "status": "completed",
      "latencyMs": 812,
      "txHash": "0x…"
    }]
  }'
# {"accepted":1,"updated":0,"duplicates":0}
```

- **Safe to retry.** Events are matched by `id`. A completed event never changes, and a pending or failed one may later become completed.
- **Unknown fields are refused,** so a payment signature can't be stored by mistake.
- **Events start `unverified`,** and nothing you send can verify them.
- **`payTo` must be yours,** or the whole batch gets `pay_to_mismatch`. Don't retry that batch.

`POST /v1/ingest/heartbeat` reports that a proxy is running, with its latest doctor result.

| Endpoint | Purpose |
|---|---|
| `POST /v1/keys` | Create a key. At most 10 active |
| `GET /v1/keys` | List keys, without secrets |
| `DELETE /v1/keys/:id` | Revoke a key |

## Rate limits

Per minute:

| Endpoint | Limit | Per |
|---|---|---|
| `POST /v1/auth/nonce` | 20 | IP |
| `POST /v1/auth/verify` | 10 | IP |
| `/v1/ingest/*` | 600 | Key |
| `/v1/ingest/*` | 1200 | IP |
| `/v1/me/*` | 300 | Provider |

Over the limit you get `429 rate_limited`. Events are limited to 500 per request and 1 MB.

## Health

`GET /health` needs no auth, and shows the service status and how far the indexer has got. All error codes are in the [error reference](/docs/reference/errors#cloud-api-errors).
