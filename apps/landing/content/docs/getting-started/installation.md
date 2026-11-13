---
id: installation
title: Installation
sidebar_position: 3
---

# Installation

ChainPe is a monorepo. Most users only need one or two packages. Install exactly what you need.

## Core SDK

The primary package for making x402 payments and reading/writing ERC-8004 reputation:

```bash
npm install @chainpeavax/sdk
# or
pnpm add @chainpeavax/sdk
```

**Peer dependencies:** None. The SDK bundles `viem` and `x402` internals.

**Node version:** 18+ required (uses native `fetch`, top-level await in examples).

## AI Framework Tools

Vercel AI SDK and LangChain tool adapters — drop-in `chainpeFetch` and `discoverService` tools:

```bash
npm install @chainpeavax/ai-tools
```

If using the Vercel AI SDK adapter:
```bash
npm install ai @ai-sdk/anthropic   # or @ai-sdk/openai, etc.
```

If using the LangChain adapter:
```bash
npm install @langchain/core @langchain/langgraph
```

## CLI

The provider proxy and consumer command-line tool:

```bash
npm install -g @chainpeavax/cli
# then
chainpe --help
```

Or use it without installing globally:
```bash
npx @chainpeavax/cli discover
npx @chainpeavax/cli fetch <url>
```

## Standalone Agent SDK

The `@chainpeavax/agent` package provides a self-contained LLM agent loop that discovers and pays for services:

```bash
npm install @chainpeavax/agent
```

## Claude MCP Wallet

The `chainpe-wallet-mcp` package gives Claude Desktop an Avalanche x402 wallet with 9 tools. It is built as a binary, not published to npm. See the [README](https://github.com/SamyaDeb/ChainPe/tree/main/packages/chainpe-wallet) for build and install instructions.

## Environment variables

All packages read from environment variables. The minimum set for making payments:

```bash
# Your EOA private key — signs EIP-3009 USDC authorizations
CHAINPE_PRIVATE_KEY=0x...

# Target network: avalanche (mainnet) or avalanche-fuji (testnet)
CHAINPE_NETWORK=avalanche

# Deployed ChainPeRegistry (Avalanche C-Chain mainnet)
CHAINPE_REGISTRY_ADDRESS=0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E

# ERC-8004 reputation registries (Avalanche C-Chain mainnet)
ERC8004_REPUTATION_REGISTRY=0xfe7Df66e6BFbd3A76B68dDF26b9312E6c85a38543
```

Copy `.env.example` from the repo root and fill in your values. Never commit a `.env` file with real keys.

## TypeScript configuration

The SDK ships full TypeScript types. It uses ES module output, so ensure your `tsconfig.json` has:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022"
  }
}
```

Or if using CommonJS in your project, use a dynamic import:

```ts
const { ChainPe } = await import('@chainpeavax/sdk')
```
