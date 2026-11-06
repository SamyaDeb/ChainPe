# Changelog

All notable changes to ChainPe are documented here.

## [3.1.2] — 2026-11-06 (Arc)

`@chainpearc/cli` 3.1.2.

### Fixed
- `chainpe start` writes `/.well-known/x402`, `/openapi.json` and the discovery document when they are missing, so a hosted proxy serves them without a local `chainpe doctor` run. It never overwrites them.

## [3.1.1] — 2026-11-06 (Arc)

`@chainpearc/cli` 3.1.1, `@chainpearc/sdk` 0.4.1 and `@chainpearc/wallet-mcp` 0.4.1.

### Fixed
- An empty `CHAINPE_ACCOUNTS_ADDRESS`, `ERC8004_REPUTATION_REGISTRY` or RPC URL now means "use the default". Claude Desktop sends blank settings as empty text, which broke search and payments in the wallet extension.

## [3.1.0] — 2026-11-06 (Arc)

Packages: `@chainpearc/cli` 3.1.0, `@chainpearc/sdk` 0.4.0, `@chainpearc/ai-tools` 0.4.0, `@chainpearc/wallet-mcp` 0.4.0, and `@chainpearc/agent` 3.1.0, its first release on Arc.

### Added
- The proxy can sell an MCP server: connecting and listing tools are free, and each `tools/call` is priced per tool.
- `@chainpearc/agent` runs on Arc, built on the SDK, with per-call and per-task spending limits.
- The MCP wallet saves today's spending, so a restart no longer resets the daily limit.

### Changed
- With routes listed, a path outside them answers 404 and costs nothing. `chargeUnlistedPaths: true` keeps the old behaviour.
- Search drops Circle listings that share no word with the query.
- A Gateway-only payment signed by a plain x402 client now explains why it failed.
- zod 4 in the wallet and AI tools, which removes a memory advisory.

## [3.0.0] — 2026-11-06 (Arc, ETHGlobal Mumbai)

Built during ETHGlobal Mumbai. Details and proof: [`docs/arc/`](arc/README.md) and [`docs/arc/PROOF.md`](arc/PROOF.md).

### Changed
- The npm packages moved from `@chainpeavax` to the `@chainpearc` scope: `@chainpeavax/cli` is now `@chainpearc/cli`, `@chainpeavax/sdk` is `@chainpearc/sdk`, `@chainpeavax/ai-tools` is `@chainpearc/ai-tools`, and `@chainpeavax/agent` is `@chainpearc/agent`. `@chainpearc/wallet-mcp` is new. Versions: `@chainpearc/cli` 3.0.0, `@chainpearc/sdk` 0.3.0, `@chainpearc/ai-tools` 0.3.0, `@chainpearc/agent` 3.0.0, `@chainpearc/wallet-mcp` 0.3.0.
- The CLI now runs on Circle's Arc (`arc-testnet`, `arc`). Avalanche support was removed from the CLI; the June version stays at tag `avalanche-june-2026`.
- Moved from x402 v1 to x402 v2.
- The website docs were rewritten for Arc. June deployment records and benchmarks moved to `docs/avalanche/`, and the Avalanche env templates moved to `contracts/.env.example` and `docs/avalanche/env.mainnet.example`.
- Payments settle through Circle's Facilitator Service, before the provider's API is called.

- `@chainpearc/sdk`, `@chainpearc/ai-tools` and `@chainpearc/wallet-mcp` moved to Arc and x402 v2. Avalanche was removed from them.
- The MCP wallet's `pay` tool now pays a URL on a chosen rail, instead of returning a bare signed payment. It no longer rates a provider on every call: Claude rates with `give_feedback` when it chooses to. `transfer_avax` is gone.

### Fixed
- `chainpe init` no longer crashes at the last step when Tags is left empty.

### Added
- `chainpe discover`, the SDK's `discover()` and the wallet's `search_bazaar` search Circle's Discovery API and `ChainPeAccounts`.
- The wallet's `deposit_gateway` tool, and the SDK's `depositGateway()`, for paying with no gas.
- `chainpe login` defaults to the hosted API on Arc testnet. `chainpe init` asks which paths to list. `chainpe start` refuses Arc mainnet without `--allow-mainnet`.
- Circle Gateway nanopayments as a second payment option, plus `chainpe deposit`, `balance` and `withdraw`.
- `ChainPeAccounts` contract on Arc testnet for provider accounts and the Pro plan, built and deployed with Arc Studio.
- `chainpe identity`, `register`, `deregister`, `list`, `plan`, `upgrade` and `doctor`.
- `chainpe-cloud`: wallet sign-in, telemetry, and revenue verified against Arc and Circle's records.
- Provider dashboard (`apps/arc-dashboard`), built with Arc Studio.

---

## [2.0.0] — 2026-06-17 (Avalanche mainnet)

### Mainnet deployment

- All contracts deployed and live on **Avalanche C-Chain mainnet (chainId 43114)**:
  - `ChainPeRegistry` (UUPS proxy) at `0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E`
  - `PolicyVault` (UUPS proxy) at `0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8`
  - ERC-8004 Identity, Reputation, Validation registries (UUPS proxies) — see `docs/avalanche/DEPLOYMENTS.md`
  - `ChainPeICMReceiver` / `ChainPeICMSender` for Avalanche ICM cross-L1 payments
- Fee token updated to Circle USDC on Avalanche C-Chain (`0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`)
- SDK default network changed from `'fuji'` to `'avalanche'`
- x402 network id is `avalanche` (mainnet); `avalanche-fuji` remains available for testnet opt-in
- Hosted facilitator and indexer live on Railway; dashboard deployed on Railway/Vercel
- 92 passing contract + workspace tests

---

## [1.0.0] - 2026-06-13

### Added
- Initial release of ChainPe x402 reverse proxy gateway
- `chainpe init` — interactive setup wizard saving config to `.env`
- `chainpe start` — starts the proxy reading from `.env`
- Optimistic proxying: verify locally (~10ms), proxy immediately, settle on-chain asynchronously
- Local Avalanche facilitator — full on-chain verify/settle for Avalanche C-Chain mainnet and Fuji testnet
- Per-route pricing via `routes.json`
- Admin endpoints: `/chainpe-admin/stats` and `/chainpe-admin/health`
- In-memory rate limiting per IP
- Graceful shutdown with settlement queue draining
- Structured JSON logging with `verbose` / `normal` / `quiet` levels
- `CHAINPE_LOG_LEVEL` environment variable support
- Programmatic API: `startProxyServer()` exported from package root
- Full TypeScript types exported for all public interfaces
