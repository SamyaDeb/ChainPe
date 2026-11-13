# ChainPe Wallet (MCP)

> Give Claude an Avalanche wallet that discovers and pays for services on the
> **ChainPe** on-chain registry — using the **x402** micropayment protocol.

ChainPe Wallet is a [Model Context Protocol](https://modelcontextprotocol.io)
server packaged as a Claude Desktop extension (`.mcpb`). Install it, drop in your
Avalanche wallet, set spending limits, and Claude can discover paid services,
pay for them within your budget, and return the results in the chat.

Discovery reads directly from the on-chain **ChainPeRegistry** contract on
Avalanche — no hosted backend or accounts required.

## How it works

1. **`search_bazaar`** reads the ChainPeRegistry (Avalanche app, default
   `<CHAINPE_REGISTRY_ADDRESS>`) via the indexer and lists registered services with their price
   and endpoint.
2. **`x402_fetch`** calls a service endpoint; on `402 Payment Required` it signs
   a USDC payment on Avalanche and retries — automatically.
3. A **spending tracker** enforces `MAX_PER_CALL` and `MAX_PER_DAY` (USDC)
   *before* any payment is signed.

Other tools: `check_balance`, `pay`, `transfer_usdc`, `transfer_avax`,
`spending_report`, `request_funding`, `search_bazaar`, `give_feedback`.

**On-chain reputation (ERC-8004):** after a successful paid `x402_fetch`, the
wallet automatically posts a positive on-chain score for the provider's agent.
`search_bazaar` surfaces each provider's aggregate score (read from the
Reputation Registry), and `give_feedback` lets you score a provider manually.
Set `ERC8004_REPUTATION_REGISTRY` (defaults to the deployed mainnet registry).

## Configuration

Set via the Claude Desktop config form (or env vars when run directly):

| Field | Env var | Default |
|---|---|---|
| Avalanche private key (0x…) | `CHAINPE_PRIVATE_KEY` | — (read-only if unset) |
| Network (`avalanche` / `fuji`) | `NETWORK` | `avalanche` |
| Max USDC per payment | `MAX_PER_CALL` | `0.10` |
| Max USDC per day | `MAX_PER_DAY` | `20.00` |
| ChainPe registry app id | `CHAINPE_REGISTRY_APP_ID` | `<CHAINPE_REGISTRY_ADDRESS>` |

## Build

```bash
npm install          # from the monorepo root
npm run build        # tsup → dist/index.js
npm run build:mcpb   # produces chainpe.mcpb (double-click to install in Claude Desktop)
npm test             # vitest
```

## Develop against a local MCP client

Run `dist/index.js` over stdio. For a quick check you can connect with the MCP
SDK client (`@modelcontextprotocol/sdk/client`) or the MCP Inspector and call
`search_bazaar` to read the live mainnet registry.
