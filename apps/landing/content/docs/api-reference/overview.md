---
id: api-reference-overview
title: API Reference Overview
sidebar_position: 1
slug: /api-reference/overview
---

# API Reference

REST API reference for the two ChainPe backend services.

## Base URLs

| Service | Base URL | Notes |
|---|---|---|
| **Facilitator** | `https://chainpe-facilitator-production.up.railway.app` | Avalanche C-Chain mainnet |
| **Indexer** | `https://chainpe-indexer-production.up.railway.app` | Avalanche C-Chain mainnet |

## Authentication

Neither service requires authentication for read endpoints. The facilitator's `/verify` and `/settle` endpoints accept any valid x402 payload — they are protected by rate limiting (60 req/min per IP) and the cryptographic validity of the signed USDC authorization.

## Rate limits

The facilitator applies a rate limit of **60 requests per minute per IP** on `/verify` and `/settle`. Exceeding the limit returns:

```json
HTTP 429
{ "error": "rate_limit_exceeded" }
```

## Error format

All error responses return JSON with an `error` field:

```json
{ "error": "description of the error" }
```

HTTP status codes follow standard conventions: `400` for bad requests, `404` for not found, `429` for rate limit, `500` for internal errors, `503` for service unavailable (e.g. low gas).

## CORS

The facilitator blocks cross-origin browser requests by default. To allow specific origins, set `ALLOWED_ORIGINS` in the facilitator's environment. Server-to-server calls (no `Origin` header) always work.

The indexer enables CORS for all origins.
