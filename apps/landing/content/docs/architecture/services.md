---
id: architecture-services
title: Services Architecture
sidebar_position: 4
---

# Services Architecture

ChainPe runs two Railway-deployed backend services: the **facilitator** and the **indexer**. They have distinct responsibilities and different trust levels.

## Facilitator

**Repository:** `services/chainpe-facilitator/`
**Live:** https://chainpe-facilitator-production.up.railway.app

### Responsibility

Implements the x402 HTTP facilitator contract: `POST /verify` and `POST /settle`. Receives a signed USDC payment authorization from the provider proxy, verifies it, and submits it to the Avalanche USDC contract.

### Non-custodial design

The facilitator holds only enough AVAX to pay gas. It never holds user USDC. It can only move USDC that the payer already signed and authorized — if the key leaks, an attacker gains the gas balance but cannot steal any payer funds (the EIP-3009 signature is already spent/expired).

### API surface

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Service info and endpoint list |
| `/health` | GET | Liveness check; returns 503 if gas is critically low |
| `/status` | GET | Detailed status including live gas balance |
| `/supported` | GET | Returns supported x402 schemes and networks |
| `/metrics` | GET | Prometheus text-format counters |
| `/verify` | POST | Verify a payment payload (does not submit) |
| `/settle` | POST | Verify + settle a payment on-chain |

### Configuration

| Env var | Required | Description |
|---|---|---|
| `FACILITATOR_PRIVATE_KEY` | Yes | Gas-paying key; fund with ≥ 0.1 AVAX |
| `NETWORK` | No | `avalanche` (default) or `fuji` |
| `RPC_URL` | No | Avalanche RPC override |
| `PORT` | No | HTTP port (Railway injects this) |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins |

### Rate limiting

60 requests per minute per IP. Returns `{ error: "rate_limit_exceeded" }` on excess.

### Gas health check

If the gas key balance drops below 0.05 AVAX, `/health` returns HTTP 503. Railway's health check will restart or alert. The `/metrics` endpoint exposes `chainpe_gas_balance_avax` as a Prometheus gauge.

---

## Indexer

**Repository:** `services/chainpe-indexer/`
**Live:** https://chainpe-indexer-production.up.railway.app

### Responsibility

Watches `ChainPeRegistry` and `ReputationRegistry` events on Avalanche, stores them in Postgres, and serves a REST API for O(1) discovery and reputation queries.

Without the indexer, every `cp.discover()` call would require reading all paginated contract state directly from an RPC node. The indexer makes discovery fast and filterable.

### Data model

Two tables:
- `services` — one row per active registered service (upserted on events)
- `feedback` — one row per ERC-8004 reputation feedback event

### API surface

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Service health + last indexed block |
| `/stats` | GET | Service and feedback counts |
| `/services` | GET | Paginated, filtered, ranked service list |
| `/services/:id` | GET | Single service by key or `developer:name` |
| `/services/:id/reputation` | GET | Reputation summary for a service |

Query parameters for `GET /services`:
- `query` — free-text search over name, description, tags
- `tag` — filter by exact tag
- `maxPrice` — maximum price per request in USDC
- `offset` — pagination offset (default 0)
- `limit` — page size (default 100, max 100)

### Configuration

| Env var | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string (Neon) |
| `CHAINPE_REGISTRY_ADDRESS` | Yes | ChainPeRegistry contract address |
| `REPUTATION_REGISTRY_ADDRESS` | No | ERC-8004 ReputationRegistry address |
| `NETWORK` | No | `avalanche` (default) or `fuji` |
| `RPC_URL` | No | Avalanche RPC override |
| `PORT` | No | HTTP port |

### Railway deployment

Both services include a `railway.json` configuration file. Deploy by connecting the repo to Railway and setting the environment variables listed above. Railway automatically provisions a public domain and health-checks the `/health` endpoint.
