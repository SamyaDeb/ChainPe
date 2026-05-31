# ChainPe

<img width="1255" height="699" alt="Landing" src="https://github.com/user-attachments/assets/2493bee3-5a24-4687-9003-ece3ac941683" />


**Monetize any HTTP API with blockchain micropayments. Consume paid APIs directly from Claude and other AI tools — no accounts, no API keys.**

ChainPe is a decentralized API marketplace built on Algorand. API developers publish their services to an on-chain registry and gate every request with the [x402 protocol](https://www.x402.org/) — trustless, pay-per-request micropayments in ALGO or USDC. Consumers discover and call those services by installing the ChainPe MCP extension into Claude Desktop or any MCP-compatible AI tool.

---

## How It Works

```
LLM (Claude)              ChainPe Proxy (x402)            Your Backend API
     │                           │                               │
     │  GET /endpoint            │                               │
     │──────────────────────────>│                               │
     │  402 PAYMENT-REQUIRED     │                               │
     │<──────────────────────────│                               │
     │                           │                               │
     │  Signs ALGO/USDC payment  │                               │
     │                           │                               │
     │  GET /endpoint            │  verify payment on-chain      │
     │  + PAYMENT-SIGNATURE      │──────────┐                    │
     │──────────────────────────>│          │                    │
     │                           │<─────────┘                    │
     │                           │  forward to backend           │
     │                           │──────────────────────────────>│
     │  200 + data               │  200 + data                   │
     │<──────────────────────────│<──────────────────────────────│
     │                           │                               │
     │                           │  settle on-chain              │
     │                           │──> Algorand transaction       │
```

---

## For API Developers — Publish & Monetize

Register any existing HTTP API in two commands. No changes to your backend required.

### Install

```bash
npm install -g @chainpe/chainpe
```

### 1. Configure your service

```bash
chainpe init
```

The interactive prompt collects:

```
Service name        › Weather API
Description         › Real-time weather and forecast data
Tags                › weather, forecast, data
Backend URL         › http://localhost:3001
Price per request   › 0.01
Payment token       › ALGO
Your wallet address › EZDWPOTBKBWCBQ4M6QXWF4Z3PJB5Q6XN6XAGL5KPR3ESC3HF33J...
Proxy port          › 4402
Network             › testnet
```

Your wallet address is all you need — the proxy verifies payments and forwards them directly to your wallet on-chain. It never holds your funds or needs your private key.

### 2. Start the payment gateway

```bash
chainpe start
```

This launches an x402 reverse proxy in front of your backend. Every incoming request must carry a valid Algorand payment or it gets a `402 Payment Required` response.

```
ChainPe proxy started
  Service   Weather API
  Target    http://localhost:3001
  Price     0.01 ALGO per request
  Wallet    EZDWPOTB...57A4
  Network   testnet
  Listening http://localhost:4402
```

### 3. Register on-chain

```bash
chainpe register
```

This publishes your service to the `ChainPeRegistry` smart contract on Algorand (costs 1 ALGO). Once registered, any consumer with the ChainPe MCP extension can discover and call your API immediately.

### CLI Reference

| Command | What it does |
|---|---|
| `chainpe init` | Interactive setup — creates `~/.chainpe/config.json` |
| `chainpe start` | Start the x402 payment proxy |
| `chainpe register` | Publish service to the Algorand registry |
| `chainpe list` | List all services registered on-chain |
| `chainpe deregister` | Remove your service from the registry |

### Config file (`~/.chainpe/config.json`)

| Field | Description |
|---|---|
| `serviceName` | Display name for your service |
| `serviceDescription` | Short description shown to consumers |
| `tags` | Comma-separated keywords for discovery |
| `targetUrl` | Your backend API URL |
| `pricePerRequest` | Price in ALGO or USDC |
| `paymentToken` | `"ALGO"` or `"USDC"` |
| `walletAddress` | Your Algorand wallet address (receives payments) |
| `proxyPort` | Port the x402 proxy listens on |
| `network` | `"testnet"` or `"mainnet"` |

---

## For Consumers — Use Paid APIs from LLMs

Install the ChainPe MCP extension into Claude Desktop, OpenAI, Antigravity pr whatever you want. LLMs gets an Algorand wallet, can discover services registered on-chain, and pays for them automatically within your configured budget.

### Install in Claude Desktop

1. Download `chainpe.mcpb` from [Releases](https://github.com/SamyaDeb/ChainPe/releases)
2. Double-click the `.mcpb` file — Claude Desktop installs it automatically
3. Open Claude Desktop → Settings → Extensions → ChainPe
4. Fill in your Algorand wallet mnemonic (25 words) and set spending limits

| Config field | Default | Description |
|---|---|---|
| Algorand Mnemonic | — | 25-word seed phrase, stored in OS Keychain |
| Network | `algorand-testnet` | `algorand` or `algorand-testnet` |
| Max per payment | `0.10 USDC` | Hard cap per single API call |
| Max per day | `20.00 USDC` | Daily spending limit |
| Registry App ID | `757478481` | Leave as-is unless running a custom registry |

### What Claude can do once installed

| Tool | Description |
|---|---|
| `search_bazaar` | Discover services registered on the ChainPe Algorand registry |
| `x402_fetch` | Call a service URL — auto-handles 402, signs payment, retries |
| `check_balance` | View wallet balance and address |
| `pay` | Sign an x402 payment authorization |
| `transfer_usdc` | Send USDC to any Algorand address |
| `transfer_algo` | Send ALGO (for gas) |
| `spending_report` | Review today's spend against limits |
| `request_funding` | Generate a Pera Wallet top-up link |
| `tinyman_swap` | Swap tokens via TinyMan DEX |
| `create_token` | Create a new Algorand Standard Asset |

### Example

Ask Claude:

> *"Find me trending tech news and summarize the top stories."*

Claude will:
1. Call `search_bazaar` → find the Hacker News API registered on Algorand
2. Call `x402_fetch` → get a `402`, sign a USDC payment, retry
3. Receive the data and summarize it in the chat

No API keys. No subscriptions. The payment settles on Algorand in under 5 seconds.

---

## On-Chain Deployment

### Registry Contract (Algorand Testnet)

| | |
|---|---|
| **Deployed App ID** | `757478481` |
| **Standard** | ARC-4 (ABI-compatible) |
| **Registration fee** | 1 ALGO per service |
| **Storage** | ARC-54 BoxMap keyed by `developer_address:service_name` |

### Live Registered Services

| Service | Price | Token | Network |
|---|---|---|---|
| Weather News | 0.01 | ALGO | Testnet |
| Hacker News API | 0.01 | ALGO | Testnet |

---

## Architecture

```
chainpe/
├── contracts/
│   └── src/
│       └── ChainPeRegistry.algo.ts     # ARC-4 on-chain service registry
│
├── packages/
│   ├── chainpe/                        # Provider SDK & CLI
│   │   └── src/
│   │       ├── cli.ts                  # chainpe init / start / register / list
│   │       ├── proxy/
│   │       │   ├── server.ts           # x402 reverse proxy (Express)
│   │       │   ├── routeConfig.ts      # per-route pricing
│   │       │   └── analytics.ts        # payment logs and stats
│   │       ├── registry.ts             # on-chain registry client
│   │       ├── facilitator/            # payment verification modes
│   │       └── x402/algo/
│   │           └── server-scheme.ts    # ALGO native payment scheme
│   │
│   └── chainpe-wallet/                 # MCP extension for Claude Desktop
│       ├── src/
│       │   ├── server.ts               # MCP server (stdio JSON-RPC)
│       │   ├── chainpe-registry.ts     # standalone registry reader
│       │   ├── spending.ts             # budget enforcement
│       │   └── tools/
│       │       ├── x402-fetch.ts       # auto-pay on 402
│       │       ├── bazaar-search.ts    # on-chain service discovery
│       │       ├── check-balance.ts
│       │       ├── pay.ts
│       │       ├── transfer-algo.ts
│       │       ├── transfer-usdc.ts
│       │       └── tinyman-swap.ts
│       ├── manifest.json               # MCP extension manifest
│       └── chainpe.mcpb                # installable Claude Desktop bundle
│
├── examples/
│   ├── weather-api.mjs                 # example provider: weather data
│   ├── btc-api.mjs                     # example provider: Bitcoin price
│   └── weather-railway/                # Railway deploy config
│
└── frontend/
    ├── index.html                      # landing page
    └── docs.html                       # API documentation page
```

---

## Smart Contract Methods

The `ChainPeRegistry` ARC-4 contract on Algorand exposes:

| Method | Description |
|---|---|
| `register()` | Register a service (requires 1 ALGO fee) |
| `update()` | Update metadata — only callable by the original developer |
| `deregister()` | Remove a service from the registry |
| `getService(developer, name)` | Fetch full service metadata |
| `hasService(developer, name)` | Check if a service exists |
| `getAdmin()` | Return the contract admin address |
| `getRegistrationFee()` | Return current registration fee |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (ESM), Node.js 22 |
| Web framework | Express.js |
| Blockchain | Algorand Testnet / Mainnet |
| Smart contracts | TEALScript → TEAL (ARC-4) |
| Payment protocol | x402-AVM |
| Payment SDK | `@x402-avm/express`, `@x402-avm/core` |
| Algorand SDK | `algosdk` v3 |
| MCP protocol | `@modelcontextprotocol/sdk` v1 |
| CLI tooling | Commander, `@clack/prompts`, Chalk |
| Security | OS Keychain for mnemonic storage |
| Build | tsup, npm workspaces |

---

## Local Development

```bash
git clone https://github.com/SamyaDeb/ChainPe.git
cd ChainPe
npm install
npm run build

# Start an example backend
node examples/weather-api.mjs

# In a second terminal — start the proxy
chainpe init   # configure service
chainpe start  # launch x402 gateway on :4402

# Register on Algorand testnet
chainpe register
```

To build the MCP extension bundle:

```bash
cd packages/chainpe-wallet
npm run build        # compiles TypeScript
npm run build:mcpb   # produces chainpe.mcpb
```

---

## License

MIT
