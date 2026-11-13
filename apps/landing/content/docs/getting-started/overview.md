---
id: getting-started-overview
title: Getting Started
sidebar_position: 1
---

# Getting Started

Welcome to ChainPe. This section walks you from zero to a working paid API call on Avalanche C-Chain in a few minutes.

## What you will build

By the end of this section you will have:

1. Installed the `@chainpeavax/sdk` package
2. Created a `ChainPe` client with a funded Avalanche C-Chain wallet
3. Made a real USDC micropayment to a registered API and received a response
4. Optionally registered your own service on-chain

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | The SDK uses native `fetch` and ES modules |
| A funded Avalanche C-Chain wallet | You need a small amount of USDC on Avalanche C-Chain |
| A private key | The SDK signs EIP-3009 USDC authorizations client-side |

### Getting USDC and AVAX

- **AVAX** (for gas, if running your own transactions): AVAX is available on major exchanges.
- **USDC** (for paying APIs on mainnet): USDC is available on major CEXes and bridges (e.g., [Stargate](https://stargate.finance)).

The non-custodial facilitator pays AVAX gas on your behalf when you make x402 payments, so **agents only need USDC** in their wallet, not AVAX.

## Sections

- [Installation](./installation.md) — npm/pnpm install commands for all packages
- [Quickstart](./quickstart.md) — end-to-end: make a paid call in 5 minutes
- [First Payment](./first-payment.md) — detailed walkthrough of the USDC micropayment flow

## Choosing the right entry point

| Use case | Start here |
|---|---|
| Using a paid API from your own TypeScript/JavaScript code | [Quickstart](./quickstart.md) using `@chainpeavax/sdk` |
| Building a Vercel AI SDK agent that pays for services | [AI Tools](../developers/ai-tools.md) |
| Building a LangChain agent | [AI Tools](../developers/ai-tools.md) |
| Using Claude to pay for APIs via MCP | Install `chainpe-wallet-mcp` per the README |
| Monetizing your own API | [Merchant Registration](../merchants/registration.md) |
| Running the services locally | [Deployment Overview](../deployment/overview.md) |
