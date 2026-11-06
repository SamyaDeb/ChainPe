# Project structure

```
chainpe/
├── packages/
│   ├── chainpe/              @chainpearc/cli: provider CLI (command: chainpe) and x402 proxy
│   ├── chainpe-sdk/          @chainpearc/sdk: buyer SDK
│   ├── chainpe-ai-tools/     @chainpearc/ai-tools: Vercel AI SDK and LangChain tools
│   ├── chainpe-wallet/       @chainpearc/wallet-mcp: USDC wallet for Claude and other MCP clients
│   └── chainpe-agent/        @chainpearc/agent: not moved to Arc yet, do not publish
│
├── contracts-arc/            ChainPeAccounts and its tests (Foundry, built with Arc Studio)
│
├── services/
│   ├── chainpe-cloud/        API behind the provider dashboard
│   ├── chainpe-indexer/      Legacy indexer for the June contracts
│   └── chainpe-facilitator/  Legacy facilitator, replaced by Circle
│
├── apps/
│   ├── landing/              Main site and docs (chainpe.vercel.app)
│   ├── arc-dashboard/        Provider dashboard (built with Arc Studio)
│   └── dashboard/            Older one-page marketing site
│
├── examples/
│   ├── arc-demo/             The live demo seller on Arc
│   ├── agent-surfaces/       Vercel AI SDK and LangChain agents that pay on Arc
│   ├── weather-api/          Zero-dependency weather backend
│   ├── weather-railway/      Railway-deployable weather backend
│   └── avalanche-bench/, policy-vault/, proxy-railway/, seller-agents/
│                             Legacy examples for the June contracts
│
├── contracts/                Legacy Hardhat contracts, deployed in June 2026
├── e2e/                      Legacy end-to-end harness for the June contracts
│
└── docs/
    ├── arc/                  Plan, specs, reviews and proof for the Arc version
    ├── avalanche/            June 2026 README, deployed addresses and benchmarks
    ├── CHANGELOG.md
    └── STRUCTURE.md          This file
```
