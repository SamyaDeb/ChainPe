# Changelog

All notable changes to ChainPe are documented here.

## [Latest] — 2026-06-17

### Mainnet deployment

- All contracts deployed and live on **Avalanche C-Chain mainnet (chainId 43114)**:
  - `ChainPeRegistry` (UUPS proxy) at `0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E`
  - `PolicyVault` (UUPS proxy) at `0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8`
  - ERC-8004 Identity, Reputation, Validation registries (UUPS proxies) — see `docs/DEPLOYMENTS.md`
  - `ChainPeICMReceiver` / `ChainPeICMSender` for Avalanche ICM cross-L1 payments
- Fee token updated to Circle USDC on Avalanche C-Chain (`0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`)
- SDK default network changed from `'fuji'` to `'avalanche'`
- x402 network id is `avalanche` (mainnet); `avalanche-fuji` remains available for testnet opt-in
- Hosted facilitator and indexer live on Railway; dashboard deployed on Railway/Vercel
- 92 passing contract + workspace tests

---

## [1.0.0] - 2024-07

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
