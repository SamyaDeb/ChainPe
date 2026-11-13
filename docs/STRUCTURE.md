# Project Structure

```
chainpe/
├── contracts/              Smart contracts (Hardhat, Solidity 0.8.28)
│   ├── contracts/
│   │   ├── ChainPeRegistry.sol        Service registry (UUPS proxy)
│   │   ├── PolicyVault.sol            Gasless agent spending vault (UUPS proxy)
│   │   ├── erc8004/                   ERC-8004 identity + reputation registries
│   │   ├── icm/                       Avalanche ICM cross-L1 contracts
│   │   └── mocks/                     Test-only mocks
│   ├── scripts/                       Deploy + verify scripts
│   ├── test/                          30 tests, 100% line coverage on registry
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
│   └── chainpe-indexer/      Event indexer + REST API (Postgres)
│
├── apps/
│   ├── dashboard/            Next.js marketplace dashboard
│   └── landing/              Static landing page
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
