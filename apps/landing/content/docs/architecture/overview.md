---
id: architecture-overview
title: Architecture Overview
sidebar_position: 1
---

# Architecture Overview

ChainPe is infrastructure, not a single app. One payment + reputation core drives multiple surfaces. This page gives a high-level view of how everything fits together.

## System diagram

```mermaid
graph TB
    subgraph "Client Layer"
        SDK["@chainpeavax/sdk\n(cp.fetch / cp.pay / cp.discover)"]
        AITOOLS["@chainpeavax/ai-tools\n(Vercel AI SDK / LangChain)"]
        CLI["@chainpeavax/cli\n(chainpe fetch / discover)"]
        MCP["chainpe-wallet-mcp\n(Claude Desktop)"]
        DASH["apps/dashboard\n(Next.js marketplace)"]
    end

    subgraph "Provider Layer"
        PROXY["x402 Proxy\n(chainpe start)"]
        BACKEND["Provider Backend\n(any HTTP server)"]
    end

    subgraph "ChainPe Services"
        FAC["Facilitator\n(Railway · non-custodial)"]
        IDX["Indexer\n(Railway · Postgres)"]
    end

    subgraph "Avalanche C-Chain"
        REG["ChainPeRegistry.sol\n(0x2a58...170E)"]
        PV["PolicyVault.sol"]
        ID8["ERC-8004 IdentityRegistry\n(0xB133...3195)"]
        REP8["ERC-8004 ReputationRegistry\n(0xfe7D...8543)"]
        USDC["USDC ERC-20\n(0xB97E...6a6E on mainnet)"]
        ICM["ChainPeICMReceiver.sol"]
    end

    SDK -->|"x402 fetch"| PROXY
    AITOOLS -->|"chainpeFetch tool"| PROXY
    CLI -->|"chainpe fetch"| PROXY
    MCP -->|"x402_fetch tool"| PROXY

    PROXY -->|"/settle (EIP-3009)"| FAC
    FAC -->|"transferWithAuthorization"| USDC
    USDC -->|"USDC transfer"| BACKEND

    PROXY --> BACKEND

    SDK -->|"discover, getReputation"| IDX
    DASH -->|"REST queries"| IDX
    IDX -->|"watches events"| REG
    IDX -->|"watches events"| REP8

    SDK -->|"register / deregister"| REG
    SDK -->|"giveFeedback"| REP8
    SDK -->|"setPolicy / deposit"| PV

    ICM -->|"cross-L1 intents"| REG
```

## Component responsibilities

### @chainpeavax/sdk

The primary consumer library. Wraps all x402 payment logic, ERC-8004 reputation, registry discovery, and PolicyVault interaction behind a clean TypeScript API. The `ChainPe` class is the entry point.

### @chainpeavax/ai-tools

Thin adapters that wrap SDK calls as Vercel AI SDK `tool()` objects or LangChain `StructuredTool` instances. Exposes `chainpeFetch` (pay for and call a URL) and `discoverService` (search and rank the registry).

### @chainpeavax/cli

Two roles in one package:
- **Provider**: `chainpe init/start/register` — configure and launch the x402 payment proxy
- **Consumer**: `chainpe fetch <url>` and `chainpe discover` — pay for APIs and browse the registry from the terminal

### chainpe-wallet-mcp

An MCP extension for Claude Desktop. Provides 9 tools: `x402_fetch`, `pay`, `search_bazaar`, `check_balance`, `give_feedback`, `spending_report`, `transfer_usdc`, `transfer_avax`, `request_funding`.

### x402 Proxy (chainpe start)

An Express server using the `x402-express` middleware. Gates every proxied request with a USDC payment. Two facilitator modes:
1. External: delegates to a configured facilitator URL
2. In-process: `chainpe start --facilitator <key>` runs a local facilitator

Exposes admin endpoints at `/chainpe-admin/stats`, `/chainpe-admin/payments`, `/chainpe-admin/config`, `/chainpe-admin/schema`.

### Facilitator

Implements the x402 facilitator HTTP contract: `POST /verify` and `POST /settle`. Non-custodial — the key only pays gas and relays the payer's already-signed `transferWithAuthorization`. Rate-limited to 60 req/min per IP. Prometheus metrics at `/metrics`.

### Indexer

Watches `ServiceRegistered`, `ServiceUpdated`, `ServiceDeregistered` events from `ChainPeRegistry` and reputation feedback events from `ReputationRegistry`. Stores results in Postgres. Serves a REST API for O(1) discovery and reputation queries.

### Avalanche C-Chain contracts

- `ChainPeRegistry`: the service marketplace. Keyed by `keccak256(developer, name)`.
- ERC-8004 registries: portable agent identity + reputation + validation
- `PolicyVault`: gasless, policy-bounded spending
- `ChainPeICMReceiver`: receives cross-L1 payment intents via Avalanche Teleporter

## Data flow: discovery → payment → reputation

```mermaid
sequenceDiagram
    participant Agent
    participant Indexer
    participant Proxy
    participant Facilitator
    participant USDC
    participant ReputationRegistry

    Agent->>Indexer: GET /services?query=weather&maxPrice=0.05
    Indexer-->>Agent: [{ name, endpoint, pricePerRequest, reputation }] (ranked)

    Agent->>Proxy: GET https://weather.chainpe.app/data
    Proxy-->>Agent: 402 { accepts: [{ network: "avalanche", maxAmountRequired: "10000", payTo: "0x..." }] }

    Note over Agent: Sign EIP-3009 authorization off-chain

    Agent->>Proxy: GET /data + X-PAYMENT header
    Proxy->>Facilitator: POST /settle
    Facilitator->>USDC: transferWithAuthorization(agent→provider, 0.01 USDC)
    USDC-->>Facilitator: tx confirmed
    Facilitator-->>Proxy: { success: true, transaction: "0xabc..." }
    Proxy-->>Agent: 200 OK + X-PAYMENT-RESPONSE

    Agent->>ReputationRegistry: giveFeedback(agentId=42, score=100)
```

## Trust boundaries

| Boundary | Trust assumption |
|---|---|
| Agent → Facilitator | Agent signs EIP-3009 with exact amount and recipient. Facilitator cannot redirect funds or steal more than signed. |
| Facilitator → USDC | Facilitator submits agent's signed message. USDC contract verifies the signature independently. |
| Agent → Registry | Registry is an immutable Solidity contract. Service data is what was registered on-chain. |
| Agent → Indexer | Indexer is an off-chain cache. Trust for discovery but verify on-chain for critical operations. |
| Owner → PolicyVault | PolicyVault enforces on-chain. No backend can override it. |
