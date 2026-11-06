---
title: Cloud API
description: The API behind the provider dashboard.
---

`chainpe-cloud` handles wallet sign-in, proxy reports, Arc indexing and verified revenue. It holds no private keys.

Base URL: `https://chainpe-cloud-production.up.railway.app`

The full API is in [`openapi.yaml`](https://github.com/SamyaDeb/ChainPe/blob/arc/services/chainpe-cloud/openapi.yaml), with real sample responses in [`fixtures`](https://github.com/SamyaDeb/ChainPe/tree/arc/services/chainpe-cloud/fixtures).

## Sign-in

Sign-in uses Sign-In with Ethereum. It needs a wallet with a provider account, and returns a bearer token. Without an account you get `403 not_registered`.

| Endpoint | Body or auth | Result |
|---|---|---|
| `POST /v1/auth/nonce` | `{ address, client? }` | `{ nonce, message, expiresAt }` |
| `POST /v1/auth/verify` | `{ message, signature }` | `{ token, tokenType, address, expiresAt }` |
| `POST /v1/auth/logout` | Bearer token | Ends the session |
| `POST /v1/keys` | Bearer token | Creates an ingest key, shown once |
| `GET /v1/keys` | Bearer token | Lists keys |
| `DELETE /v1/keys/:id` | Bearer token | Revokes a key |

`chainpe login` does all of this for you.

## Proxy reports

These use an ingest key, as `Authorization: Bearer cpk_...`.

| Endpoint | What it does |
|---|---|
| `POST /v1/ingest/events` | Reports payments. Safe to retry, because events are matched by id |
| `POST /v1/ingest/heartbeat` | Reports that a proxy is running, with its latest doctor result |

## Your data

These use a bearer token and only return your own data. The server enforces your plan, and a Pro-only request on Free returns `403 plan_required`.

| Endpoint | Returns |
|---|---|
| `GET /v1/me` | Your account and plan |
| `GET /v1/me/services` | Your services and their last heartbeat |
| `GET /v1/me/summary` | Revenue, calls and buyers over a time range |
| `GET /v1/me/payments` | Your payments |
| `GET /v1/me/payments.csv` | Your payments as CSV |
| `GET /v1/me/buyers` | Who paid you, and how much |
| `GET /v1/me/reputation` | Your ratings |
| `GET /v1/me/health` | Your doctor results |
| `GET /v1/me/fees` | Your fee status |
| `GET /v1/me/wallets`, `PUT /v1/me/wallets` | Your own wallets, so self-payments can be filtered out |

`GET /health` shows whether the service is up.
