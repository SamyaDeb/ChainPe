# Spec 05 — `chainpe doctor`

**Goal:** make a provider's service findable by agents and ready for Circle's Agent Marketplace review.
Public audits of the x402 Bazaar show most failures are missing `/.well-known/x402`, no MCP surface,
dead listed routes, and thin output schemas — doctor checks all of these.

## What it generates (written next to the config, served free by the proxy)

| File / path | Content |
|---|---|
| `openapi.json` (served at `/openapi.json`) | OpenAPI 3.1 from `routes.json` + sampled responses: path, method, params, response schema with field types, price in `x-x402-price` |
| `/.well-known/x402` | x402 discovery document: resources, prices, networks, rails, payTo, description, docs URL. Circle's docs do not define this format, so this shape is ours; only the OpenAPI document is a Circle prerequisite |
| `discovery.json` | one Circle Discovery `ServiceListing` per route: `resource`, `type`, `x402Version`, `accepts[]` (`scheme`, `network`, `asset`, `amount`, `payTo`, `extra`), `metadata` (`provider` {`name`, `description`, `category`, `tags`, `website`, `docsUrl`, `openApiUrl`}, `path`, `method`, `description`, `mimeType`, `input`, `output`, `siwx`, `supportsVanillax402`, `supportsCircleGateway`) |

Routes come from `routes` in the CLI config. A config with only the catch-all route cannot be documented.

Response schemas: call each route once through the proxy with a test payment (or `--sample <file>`),
infer a JSON schema with real field names and types; never ship `{type, example}` only.
Keep each example under 1.5 KB (larger samples are dropped by common indexers).

## Checks (pass/fail table)

| # | Check |
|---|---|
| 1 | Endpoint reachable over HTTPS (warn on http / localhost) |
| 2 | Unpaid request returns 402 with decodable `PAYMENT-REQUIRED` |
| 3 | Every `accepts` entry has `network` (CAIP-2), `payTo`, readable price |
| 4 | Arc option present (`eip155:5042` or `eip155:5042002`) |
| 5 | Gateway option present (warn if missing) |
| 6 | `/.well-known/x402` served and matches live 402 (no drift) |
| 7 | `/openapi.json` served; every paid route documented; schemas have field names |
| 8 | Description ≥ 160 chars, uses buyer words (warn) |
| 9 | ERC-8004 agentId set and owned by the provider (spec 10) |
| 10 | Registered in `ChainPeAccounts` (spec 06) |
| 11 | Test payment settles and backend answers 2xx (optional `--pay`, uses buyer key) |
| 12 | Service visible in Circle Discovery API (`?payTo=<wallet>`, matching `resource` exactly) — info only; listing is manual |

Output: table + score; `--json` for the dashboard; exits 1 if any required check fails.
On success print the Circle "Get listed" intake fields: endpoint URL, payout wallet, description,
OpenAPI URL. Heartbeat sends the JSON result to chainpe-cloud (spec 08).

## Acceptance

- [ ] Fresh demo seller: doctor generates all three files and passes 1–7, 9, 10.
- [ ] Breaking `/.well-known/x402` (edit price) → check 6 fails with a diff.
- [ ] `--json` output validates against `docs/arc/specs/schemas/doctor.schema.json` (create it).
