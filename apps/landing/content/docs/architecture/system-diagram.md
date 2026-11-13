---
id: system-diagram
title: System Diagram
sidebar_position: 2
---

# System Diagram

Detailed component map of the ChainPe system, including data stores, external dependencies, and flow directions.

```mermaid
graph TB
    subgraph "Client Layer"
        AI["AI Agent\n(Node.js / Python / Claude)"]
        DEV["Developer App\n(@chainpeavax/sdk)"]
        DASH["Dashboard\napps/dashboard\n(Next.js / Vercel)"]
    end

    subgraph "ChainPe NPM Packages"
        SDK["@chainpeavax/sdk\nChainPe class\nRegistryClient\nPolicyVaultClient\nReputationClient"]
        TOOLS["@chainpeavax/ai-tools\ncreateChainPeTools (Vercel)\ncreateChainPeLangChainTools"]
        CLICMD["@chainpeavax/cli\nchainpe init/start/register\nchainpe fetch/discover"]
    end

    subgraph "ChainPe Services (Railway)"
        PROXY["x402 Proxy\nExpress + x402-express\nPort 4402"]
        FAC["Facilitator\nservices/chainpe-facilitator\nPort 4500"]
        IDX["Indexer\nservices/chainpe-indexer\nPort 3001"]
        PG[("Postgres\nNeon DB")]
    end

    subgraph "Avalanche C-Chain (chainId 43114)"
        REG["ChainPeRegistry.sol\n0x2a58...170E (mainnet)"]
        PV["PolicyVault.sol\n0xFe38...168D8 (mainnet)"]
        IDNTY["IdentityRegistry\n(ERC-8004 UUPS proxy)\n0xB133...3195"]
        REPDB["ReputationRegistry\n(ERC-8004 UUPS proxy)\n0xfe7D...8543"]
        USDC["USDC ERC-20\n0xB97E...6a6E (mainnet)"]
        ICMRcv["ChainPeICMReceiver\n0xc8aB...6D33"]
    end

    subgraph "External Avalanche L1"
        ICMSnd["ChainPeICMSender"]
        Teleporter["Teleporter (ICM)\n0x253b...fcf"]
    end

    AI --> SDK
    AI --> TOOLS
    AI --> CLICMD
    DEV --> SDK

    SDK -->|"x402 fetch (auto-pay 402)"| PROXY
    TOOLS -->|"chainpeFetch / discoverService"| PROXY
    CLICMD -->|"chainpe fetch <url>"| PROXY

    PROXY -->|"POST /settle"| FAC
    FAC -->|"transferWithAuthorization"| USDC

    SDK -->|"GET /services"| IDX
    DASH -->|"GET /services, /stats"| IDX
    IDX --> PG
    IDX -->|"eth_getLogs (poll)"| REG
    IDX -->|"eth_getLogs (poll)"| REPDB

    SDK -->|"register() call"| REG
    SDK -->|"giveFeedback()"| REPDB
    SDK -->|"deposit(), setPolicy()"| PV

    CLICMD -->|"register()"| REG
    CLICMD -->|"IdentityRegistry.register()"| IDNTY

    ICMSnd -->|"sendCrossChainMessage"| Teleporter
    Teleporter -->|"receiveTeleporterMessage"| ICMRcv
    ICMRcv -->|"emit CrossChainPaymentIntent"| IDX
```

## Key data paths

### Happy-path payment (no PolicyVault)

```
Agent
  → cp.fetch(url)
  → GET url → 402 { accepts: [...] }
  → sign EIP-3009 authorization (off-chain, no gas)
  → GET url + X-PAYMENT
  → Proxy: POST /settle to Facilitator
  → Facilitator: USDC.transferWithAuthorization(agent→provider, amount)
  → Avalanche: confirm in ~1-2s
  → Facilitator: { success: true, transaction: "0x..." }
  → Proxy: forward to Backend → 200
  → Agent: receives PaidResult with txHash
```

### Happy-path payment (with PolicyVault)

```
Agent (session key)
  → PolicyVaultClient.signSpend(owner, to, amount)
  → returns SpendAuthorization { signature, nonce, deadline }

Relayer (facilitator or service)
  → PolicyVaultClient.relaySpend(auth)
  → PolicyVault.spend(owner, to, amount, deadline, sig)
  → [on-chain: verify sig, check all caps]
  → USDC.transfer(to, amount)
  → emit Spent(owner, to, amount, relayer, nonce)
```

### Discovery path (via indexer)

```
Agent
  → cp.discover({ query: "weather", maxPrice: "0.05" })
  → GET https://indexer/services?query=weather&maxPrice=0.05
  → Indexer: SQL query over cached service + feedback rows
  → Returns: ranked list of ServiceDto with reputation
```

### Discovery path (via on-chain read)

```
Agent
  → RegistryClient.listAllServices()
  → ChainPeRegistry.getServiceCount()
  → ChainPeRegistry.getServices(offset, 100) [paginated]
  → Returns: all active Service structs
  → SDK: rankByReputation() sorts by ERC-8004 score
```
