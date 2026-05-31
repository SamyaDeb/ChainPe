# Changelog

All notable changes to ChainPe are documented here.

## [1.0.0] - 2024-07

### Added
- Initial release of ChainPe x402 reverse proxy gateway
- `chainpe init` — interactive setup wizard saving config to `.env`
- `chainpe start` — starts the proxy reading from `.env`
- Optimistic proxying: verify locally (~10ms), proxy immediately, settle on-chain asynchronously
- Local Avalanche facilitator — full on-chain verify/settle for Fuji and C-Chain mainnet
- Per-route pricing via `routes.json`
- Admin endpoints: `/chainpe-admin/stats` and `/chainpe-admin/health`
- In-memory rate limiting per IP
- Graceful shutdown with settlement queue draining
- Structured JSON logging with `verbose` / `normal` / `quiet` levels
- `CHAINPE_LOG_LEVEL` environment variable support
- Programmatic API: `startProxyServer()` exported from package root
- Full TypeScript types exported for all public interfaces
