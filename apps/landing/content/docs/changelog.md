---
id: changelog
title: Changelog
sidebar_position: 11
---

# Changelog

All notable changes to ChainPe are documented here.

## 2026-06-17 — Mainnet Launch

- Deployed and verified all contracts on Avalanche C-Chain mainnet (chainId 43114) — ChainPeRegistry proxy `0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E`, PolicyVault proxy `0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8`, ERC-8004 registries (IdentityRegistry `0xB1330d7B1b083ba689C7f56bDf667F1F528a3195`, ReputationRegistry `0xfe7Df66e6BFbd3A76B68dDF26b9312E6c85a38543`, ValidationRegistry `0x91477bD9211448a85eFb16ea858432a85d89b833`), ICM Receiver/Sender.

---

## [2.0.0] — 2026-06

### Added (Phases 1–8 of the build plan)

**Phase 0 — Infrastructure rewrite + PITCH**
- Migrated from Algorand ARC-4 to Avalanche C-Chain (Solidity 0.8.28 + OpenZeppelin)
- Complete README rewrite documenting all surfaces
- `docs/WHY-AVALANCHE.md` — measured finality + fees, ICM rationale

**Phase 1 — @chainpeavax/sdk**
- `ChainPe` class with `fetch()`, `pay()`, `discover()`, `getReputation()`, `giveFeedback()`, `balance()`
- `RegistryClient` with `listAllServices()`, `filterServices()`, `rankByReputation()`
- `PolicyVaultClient` with owner/agent/relayer roles and EIP-712 signing
- Full TypeScript types: `ChainPeOptions`, `ChainPeService`, `RankedService`, `PaidResult`, `PaymentInfo`, `SpendAuthorization`
- `ChainPePaymentError` with `txHash` and `reason`
- Published to npm as `@chainpeavax/sdk@0.2.0`

**Phase 2 — @chainpeavax/ai-tools + CLI**
- Vercel AI SDK adapter: `createChainPeTools()` → `chainpeFetch`, `discoverService`
- LangChain adapter: `createChainPeLangChainTools()` → `chainpe_fetch`, `discover_service`
- Framework-agnostic core: `runFetch`, `runDiscover`, zod schemas, tool descriptions
- CLI: `chainpe init`, `start`, `register`, `deregister`, `list`, `status`, `fetch`, `discover`
- x402 proxy with in-process facilitator mode (`--facilitator <key>`)
- Admin endpoints: `/chainpe-admin/stats`, `/chainpe-admin/payments`, `/chainpe-admin/config`, `/chainpe-admin/schema`
- ERC-8004 `agentId` advertisement on 402 response body + `X-CHAINPE-AGENT-ID` header (phase 3b)

**Phase 3 — Seller agents**
- `examples/seller-agents/` — three seller agents and a buyer orchestrator
- `avax-analysis-agent.mjs`, `avax-dex-agent.mjs`, `avax-news-agent.mjs`
- `register-seller.mjs` with auto-mint ERC-8004 identity
- `launch.sh` for scripted startup

**Phase 4 — Facilitator + Indexer (Railway)**
- `services/chainpe-facilitator/` — non-custodial x402 verify/settle
  - Rate limiting (60 req/min per IP)
  - Gas balance health check (503 on low gas)
  - Prometheus metrics at `/metrics`
  - Background gas balance cache
- `services/chainpe-indexer/` — events → Postgres → REST
  - `GET /services` with query/tag/maxPrice filter + pagination
  - `GET /services/:id` and `GET /services/:id/reputation`
  - `GET /stats`, `GET /health`

**Phase 5 — apps/dashboard (marketplace)**
- Next.js marketplace showing reputation-ranked services
- Register via MetaMask flow
- Live reads verified against deployed contracts

**Phase 6 — PolicyVault (gasless spending)**
- `PolicyVault.sol` with per-call cap, daily cap, total budget, expiry, allowlist
- EIP-712 `Spend` typehash
- `previewSpend()` view function
- `cleanupDailySpent()` for gas reclaim
- `PolicyVaultUpgradeable.sol` — UUPS version for mainnet
- `PolicyVaultClient` in `@chainpeavax/sdk`

**Phase 7 — Avalanche bench + ICM**
- `contracts/contracts/icm/ChainPeICMSender.sol` and `ChainPeICMReceiver.sol`
- `MockTeleporterMessenger.sol` for Hardhat ICM testing
- `ChainPeICM.test.ts` — cross-chain intent tests
- `docs/WHY-AVALANCHE.md` — live reproducible benchmark

### Smart contracts deployed (Avalanche C-Chain mainnet, 2026-06-17)

| Contract | Address |
|---|---|
| ChainPeRegistry (proxy) | `0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E` |
| PolicyVault (proxy) | `0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8` |
| ERC-8004 IdentityRegistry | `0xB1330d7B1b083ba689C7f56bDf667F1F528a3195` |
| ERC-8004 ReputationRegistry | `0xfe7Df66e6BFbd3A76B68dDF26b9312E6c85a38543` |
| ERC-8004 ValidationRegistry | `0x91477bD9211448a85eFb16ea858432a85d89b833` |
| ChainPeICMReceiver | `0xc8aBD919F597C46dA889e76704F69A2809cd6D33` |
| ChainPeICMSender | `0x097D7D4B46CB894142a72E91c3b8F8b5834255dF` |

Legacy Fuji (testnet, 2026-06-13) contracts are retained in `contracts/deployments/fuji*.json` for reference.

---

## [1.0.0] — 2024-07

### Added (Initial release — Algorand era, prior to Avalanche migration)

- Initial `chainpe` x402 reverse proxy gateway
- `chainpe init` / `chainpe start` (read from `.env`)
- Optimistic proxying: verify locally, settle on-chain asynchronously
- Local Avalanche facilitator for Fuji and C-Chain mainnet
- Per-route pricing via `routes.json`
- Admin endpoints: `/chainpe-admin/stats`, `/chainpe-admin/health`
- In-memory rate limiting per IP
- Graceful shutdown with settlement queue draining
- Structured JSON logging (`verbose` / `normal` / `quiet`)
- `CHAINPE_LOG_LEVEL` env var support
- Programmatic API: `startProxyServer()` exported from package root
- Full TypeScript types for public interfaces
