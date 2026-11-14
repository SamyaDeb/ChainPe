# Project Structure

```
chainpe/
├── contracts/              Smart contracts (Hardhat, Solidity 0.8.28)
│   ├── contracts/
│   │   ├── ChainPeRegistry.sol        Service registry (UUPS proxy)
│   │   ├── PolicyVault.sol            Gasless agent spending vault (UUPS proxy)
│   │   ├── erc8004/                   ERC-8004 identity + reputation registries
│   │   ├── ChainPeReputationOracle.sol Attester-published payment-verified scores
│   │   ├── icm/                       ICM sender, fail-closed receivers, ChainPeReputationMirror
│   │   ├── legacy/                    Frozen v1 sources for upgrade validation
│   │   └── mocks/                     Test-only mocks
│   ├── scripts/                       Deploy + verify scripts
│   ├── test/                          Hardhat tests (live tests gated by RUN_LIVE_E2E)
│   ├── icm-relayer/                   icm-relayer config for the Fuji L1 demo
│   └── deployments/                   Deployed addresses per network
│
├── packages/
│   ├── chainpe/              Provider SDK + CLI (@chainpeavax/cli)
│   │   └── src/
│   │       ├── cli.ts                 `chainpe init`, `chainpe start`, `chainpe list`
│   │       ├── registry.ts            On-chain registration via viem
│   │       └── proxy/                 x402-express payment proxy + facilitator
│   │
│   ├── chainpe-agent/        Consumer agent SDK (@chainpeavax/agent)
│   │   └── src/
│   │       ├── agent.ts               Autonomous AI agent (discover → pay → use)
│   │       ├── registry.ts            On-chain service discovery
│   │       └── tools/                 AI tool definitions
│   │
│   ├── chainpe-sdk/          Shared SDK types + helpers (@chainpeavax/sdk)
│   ├── chainpe-ai-tools/     LLM tool schemas for MCP / function calling
│   └── chainpe-wallet/       MCP wallet server (62 tests)
│       └── scripts/build-mcpb.sh      Builds .mcpb for Claude Desktop
│
├── services/
│   ├── chainpe-facilitator/  Non-custodial x402 settlement (Railway-deployable)
│   ├── chainpe-indexer/      Legacy discovery indexer + REST API (Postgres)
│   └── chainpe-cloud/        Indexer, rating verifier, public + provider API, serves the dashboard
│
├── apps/
│   ├── landing/              Next.js landing + fumadocs docs (chainpe.vercel.app)
│   └── avalanche-dashboard/  Vite app: public explorer, sample provider, provider dashboard (/dashboard)
│
├── examples/
│   ├── weather-api/          Zero-dependency weather backend
│   ├── weather-railway/      Railway-deployable weather backend
│   ├── proxy-railway/        Railway-deployable x402 proxy
│   ├── seller-agents/        Multi-agent investment marketplace demo
│   ├── agent-surfaces/       LangChain + Vercel AI SDK integrations
│   ├── avalanche-bench/      Live gas + finality benchmarks
│   └── policy-vault/         PolicyVault gasless spending demo
│
├── docs/
│   ├── CHANGELOG.md
│   ├── DEPLOYMENTS.md        Live contract addresses
│   ├── STRUCTURE.md          This file
│   └── WHY-AVALANCHE.md      Technical rationale + benchmarks
│
└── e2e/                      End-to-end test harness
```
