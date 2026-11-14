# Changelog

All notable changes to ChainPe are documented here.

## [Speedrun] — 2026-11 (Avalanche Speedrun)

### Added
- **Payment-gated reputation.** Ratings carry their x402 settlement tx in `feedbackHash`; chainpe-cloud verifies each one against the chain (USDC transfer from rater to payTo + EIP-3009 `AuthorizationUsed`) and scores only verified ratings, weighted by USDC paid. Public API `/v1/public/{services,services/:key/reviews,feed,stats,providers/:address/summary}`.
- **Reputation-gated spending.** `minReputation` / `minPaidReviews` in the SDK (0.3.0), MCP wallet (`MIN_REPUTATION`) and agent (cheapest eligible planner). PolicyVault v2 with `ChainPeReputationOracle` and a session epoch.
- **ChainPeRegistry v2.** A service can only link an ERC-8004 agent the caller owns; `deregister` works while paused; `getVersion()`.
- **Portable reputation over ICM.** `ChainPeICMSender.sendReputation` → `ChainPeReputationMirror` on our own Fuji L1; fail-closed Teleporter receivers.
- **Explorer** (`/dashboard/explore`), in-browser paid call, sample provider view, live proof strip on the landing page.

### Fixed
- Facilitator: settles only native USDC to registered services on its network, dedupes nonces, per-client rate limits.
- CLI proxy: no public facilitator routes, WebSockets off, admin endpoints need `x-admin-key`.
- MCP wallet and agent: spending caps fail closed, spend recorded at signing, AVAX transfer caps, real amounts in receipts, mainnet defaults.
- Docs: invalid ReputationRegistry address, parked-domain links, unbacked pricing/uptime claims; removed `apps/dashboard` and the stale Docusaurus builds.

---

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
- Payment proxy: verify, forward to the backend, settle before the response is released (x402-express)
- Local Avalanche facilitator — full on-chain verify/settle for Avalanche C-Chain mainnet and Fuji testnet
- Per-route pricing via `routes.json`
- Admin endpoints: `/chainpe-admin/stats` and `/chainpe-admin/health`
- Graceful shutdown with settlement queue draining
- Structured JSON logging with `verbose` / `normal` / `quiet` levels
- `CHAINPE_LOG_LEVEL` environment variable support
- Programmatic API: `startProxyServer()` exported from package root
- Full TypeScript types exported for all public interfaces
