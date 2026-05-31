# ChainPe

<img width="1470" height="814" alt="Screenshot 2026-03-22 at 12 41 45 PM" src="https://github.com/user-attachments/assets/828580bd-7a5c-44b7-9a07-621e5696b731" />

**Decentralized AI Agent Marketplace on Algorand — Monetize any API with x402 micropayments**

ChainPe enables developers to publish, discover, and monetize HTTP APIs through an on‑chain service registry on Algorand. Every API call is gated by the [x402 protocol](https://www.x402.org/), enforcing trustless pay‑per‑request micropayments in native ALGO (or USDC).

```
Consumer Agent                ChainPe Proxy (x402)            Backend API
      │                              │                            │
      │  GET /trending               │                            │
      │─────────────────────────────>│                            │
      │  402 PAYMENT-REQUIRED        │                            │
      │<─────────────────────────────│                            │
      │                              │                            │
      │  Signs ALGO payment txn      │                            │
      │                              │                            │
      │  GET /trending               │  verify payment            │
      │  + PAYMENT header            │──────────┐                 │
      │─────────────────────────────>│          │                 │
      │                              │<─────────┘                 │
      │                              │  proxy to backend          │
      │                              │───────────────────────────>│
      │  200 + JSON data             │  200 + JSON data           │
      │<─────────────────────────────│<───────────────────────────│
      │                              │                            │
      │                              │  settle on-chain (atomic)  │
      │                              │──> Algorand txn            │
```

---

## On‑Chain Proof of Work

### Registry Smart Contract (Algorand Testnet)

| Item                    | Value                                                                                                                                              |
|-------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| **Registry App ID**     | `757478481`                                                                                                                                        |
| **Explorer Link**       | [View on Allo.info (Testnet)](https://app.dappflow.org/explorer/application/757478481/transactions)                                                |
| **Contract Standard**   | ARC‑4 (ABI‑compatible)                                                                                                                             |
| **Registration Fee**    | 1 ALGO per service                                                                                                                                 |
| **Storage**             | ARC‑54 BoxMap — `developer_address + ":" + service_name`                                                                                           |

### Registered Services (on‑chain)

| Service          | Provider Wallet                                            | Price/Request | Token | Network  |
|------------------|------------------------------------------------------------|---------------|-------|----------|
| Weather News     | `HLJHLCKB3TRSM3TYLT5XRFX3XHFBZ6A67QAIXCABFC5V5IHK3ESZEMJWMU` | 0.01 ALGO     | ALGO  | Testnet  |
| Hacker News API  | `EZDWPOTBKBWCBQ4M6QXWF4Z3PJB5Q6XN6XAGL5KPR3ESC3HF33JAAN57A4` | 0.01 ALGO     | ALGO  | Testnet  |

### Consumer Agent Wallet

| Item              | Value                                                                  |
|-------------------|------------------------------------------------------------------------|
| **Agent Wallet**  | `HMPG7YLTESN4FQXIGCAHQOXDEIDUIFBOINJDGQ7WUFBTYMOIKDIN6CITPM`         |
| **Mnemonic Storage** | OS Keychain (secure, never stored in plaintext)                      |

---

## Features

- **On‑chain service registry** — ARC‑4 smart contract on Algorand stores API metadata, enabling trust‑less, permissionless discovery.
- **x402 pay‑per‑request** — Every API call requires an ALGO (or USDC) micropayment. No API keys, no subscriptions.
- **AI Agent SDK** — LLM‑driven agents autonomously discover services, pay, and fetch data using `discoverService` and `callPaidApi` tools.
- **Zero backend changes** — Reverse proxy pattern wraps any existing HTTP API with a paywall.
- **Secure wallet management** — Mnemonics stored in the OS Keychain, never in config files.
- **Optimistic proxying** — Verify payment locally, proxy immediately, settle on‑chain asynchronously.
- **Dual example APIs** — Weather API and Kaggle Hacker News dataset API included as ready‑to‑use demos.

---

## Tech Stack

| Component             | Technology                                                      |
|-----------------------|-----------------------------------------------------------------|
| **Runtime & Language** | Node.js 22 / TypeScript (ESM)                                  |
| **Web Framework**     | Express.js                                                      |
| **Blockchain**        | Algorand (Testnet / Mainnet)                                    |
| **Smart Contract**    | TEALScript → TEAL (ARC‑4 compliant)                            |
| **Payment Protocol**  | x402‑AVM (Algorand Virtual Machine)                             |
| **Payment SDK**       | `@x402-avm/express`, `@x402-avm/core`                          |
| **Algorand SDK**      | `algosdk`                                                       |
| **AI/ML Integration** | Vercel AI SDK v4 + LLM providers (OpenAI, Anthropic, Groq, etc.)|
| **CLI Tooling**       | Commander, @clack/prompts, Chalk, Gradient‑string, Ora          |
| **Security**          | OS Keychain for mnemonic storage                                |
| **Data Handling**     | RFC 4180 CSV parser, Kaggle dataset integration                 |
| **Package Manager**   | npm workspaces (monorepo)                                       |
| **Build Tool**        | tsup                                                            |

---

## Architecture

```
chainpe/
├── contracts/
│   └── src/
│       └── ChainPeRegistry.algo.ts        # On-chain AI service registry (ARC-4)
├── packages/
│   ├── chainpe/                            # Provider SDK & CLI
│   │   └── src/
│   │       ├── cli.ts                      # CLI: init, start, register, list
│   │       ├── proxy/
│   │       │   ├── server.ts               # x402 payment proxy server
│   │       │   └── routeConfig.ts          # Per-route pricing config
│   │       ├── registry.ts                 # On-chain registry client
│   │       └── x402/algo/
│   │           └── server-scheme.ts        # ALGO native payment scheme
│   └── chainpe-agent/                      # Consumer Agent SDK & CLI
│       └── src/
│           ├── agent.ts                    # LLM agent with payment tools
│           ├── cli.ts                      # CLI: init, run, status
│           ├── payment.ts                  # x402 payment client
│           ├── wallet.ts                   # Secure wallet management
│           └── tools/
│               ├── callPaidApi.ts          # Tool: call paid APIs
│               └── discoverService.ts      # Tool: discover services
├── examples/
│   ├── weather-api.mjs                     # Weather API (mock data, 0.01 ALGO/req)
│   ├── kaggle-api.mjs                      # HN Tech Trends API (9,999 posts, 0.05 ALGO/req)
│   └── hn_tech_trends.csv                  # Kaggle dataset
└── package.json                            # npm workspaces monorepo root
```

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Algorand TestNet wallet** with ALGO (get from [Algorand Faucet](https://bank.testnet.algorand.network/))

### Install & Build

```bash
git clone https://github.com/AnomalyFi/chainpe.git
cd chainpe
npm install
npm run build
npm link
```

### 1. Start a Backend API (Provider)

```bash
# Weather API on port 3001
node examples/weather-api.mjs

# OR Kaggle HN Dataset API on port 3002
node examples/kaggle-api.mjs
```

### 2. Initialize the Provider

```bash
chainpe init
# → Service name, target URL, price, wallet address, proxy port
```

### 3. Start the x402 Proxy

```bash
chainpe start
# Proxy runs on port 4403 — wraps your API with ALGO payment enforcement
```

### 4. Register On‑Chain

```bash
chainpe register
# Publishes the service to the Algorand registry (costs ~1 ALGO)
```

### 5. Test from Consumer Agent

```bash
# Initialize the consumer agent
chainpe-agent init

# Run a task — the agent discovers, pays, and fetches data automatically
chainpe-agent run "Show me trending news about OpenAI"
```

---

## Example APIs

### Weather API (`examples/weather-api.mjs`)

| Endpoint               | Description                    | Price        |
|------------------------|--------------------------------|--------------|
| `GET /health`          | Health check                   | Free         |
| `GET /weather?city=X`  | Current weather for a city     | 0.01 ALGO    |
| `GET /forecast?city=X` | 3‑day forecast                 | 0.01 ALGO    |
| `GET /cities`          | Popular cities list            | 0.01 ALGO    |

### Kaggle HN Dataset API (`examples/kaggle-api.mjs`)

Serves 9,999 Hacker News posts from the Kaggle dataset *kanchana1990/hacker-news-tech-trend-velocity-and-nlp*.

| Endpoint                      | Description                              | Price        |
|-------------------------------|------------------------------------------|--------------|
| `GET /health`                 | Health check                             | Free         |
| `GET /`                       | API documentation & endpoint listing     | 0.05 ALGO    |
| `GET /trending?limit=10`      | Top posts by Score_Velocity              | 0.05 ALGO    |
| `GET /search?q=openai`        | Full‑text search on titles               | 0.05 ALGO    |
| `GET /news`                   | Alias for /trending                      | 0.05 ALGO    |
| `GET /viral`                  | Viral posts (Is_Viral=1)                 | 0.05 ALGO    |
| `GET /stats`                  | Aggregate dataset statistics             | 0.05 ALGO    |
| `GET /posts?page=1&limit=20`  | Paginated post listing                   | 0.05 ALGO    |
| `GET /posts/:id`              | Single post by ID                        | 0.05 ALGO    |
| `GET /by-type?type=Ask_HN`    | Filter by post type                      | 0.05 ALGO    |

---

## Smart Contract Methods

The `ChainPeRegistry` contract (ARC‑4) exposes the following methods:

| Method            | Description                                                 |
|-------------------|-------------------------------------------------------------|
| `register()`      | Register a new service (requires 1 ALGO payment)            |
| `update()`        | Update an existing service's metadata                       |
| `deregister()`    | Remove a service from the registry                          |
| `getService()`    | Query a service's full metadata by developer + name         |
| `hasService()`    | Check if a service exists                                   |
| `getAdmin()`      | Get the contract admin address                              |
| `getRegistrationFee()` | Get the current registration fee (1 ALGO)              |

---

## How It Works

### Provider Flow
1. Developer creates an HTTP API (weather, datasets, ML models, etc.).
2. Runs `chainpe init` to configure pricing and wallet.
3. Runs `chainpe start` to launch the x402 proxy.
4. Runs `chainpe register` to publish the service on Algorand.

### Consumer Flow
1. AI agent runs `discoverService("weather")` → queries the on‑chain registry.
2. Agent finds the service endpoint and pricing info.
3. Agent calls `callPaidApi("Weather News", "/weather?city=Mumbai")`.
4. The SDK automatically signs an ALGO payment transaction and attaches it to the request.
5. The proxy verifies the payment, forwards the request, and returns the data.

### Payment Flow
1. Consumer sends a request to the proxy.
2. Proxy returns `402 Payment Required` with payment requirements.
3. Consumer signs an Algorand payment transaction and retries with the `PAYMENT` header.
4. Proxy verifies the transaction, forwards to backend, and settles on‑chain.

---

## Key Design Decisions

1. **Reverse proxy pattern** — `http-proxy-middleware` wraps any HTTP service. Zero backend code changes required.
2. **Algorand ARC‑4 registry** — On‑chain, ABI‑compatible smart contract for decentralized, permissionless service discovery.
3. **x402‑AVM protocol** — HTTP 402 payment challenges with Algorand native payments. Clients pay in ALGO, no need for gas tokens.
4. **OS Keychain storage** — Wallet mnemonics are stored in macOS Keychain / Linux Secret Service, never in plaintext config files.
5. **Service‑level payment cache** — Prevents duplicate payments when the AI agent calls multiple endpoints on the same service within a session.
6. **RFC 4180 CSV parser** — Handles quoted fields with embedded commas for reliable dataset parsing.

---

## Challenges Faced

- **CSV parsing** — Titles with commas broke the naïve parser; implemented a full RFC 4180‑compliant quoted‑field parser.
- **x402 payment headers** — Service description lived in `resource.description` (v2 format), not in `accepts[0]`; fixed the payment client to read it correctly.
- **Double payments** — The agent paid separately for `/` (docs) and `/search`; added a service‑level cache to reuse payments across paths.
- **Secure wallet storage** — Migrated from plaintext config to OS Keychain with a `migrate-keychain` command for existing users.

---

## The Problem It Solves

Traditional API marketplaces rely on centralized platforms with high fees, opaque pricing, and restrictive access controls. ChainPe creates a decentralized, pay‑per‑use marketplace where developers register APIs on Algorand's blockchain and gate access through x402 micropayments. AI agents can autonomously discover, pay for, and consume these APIs without manual credential management—lowering barriers for data providers, ensuring transparent compensation, and enabling composable AI‑driven workflows that scale across the decentralized web.

---

## License

MIT
