# ChainPe Wallet (MCP)

> Give Claude an Algorand wallet that discovers and pays for services on the
> **ChainPe** on-chain registry — using the **x402** micropayment protocol.

ChainPe Wallet is a [Model Context Protocol](https://modelcontextprotocol.io)
server packaged as a Claude Desktop extension (`.mcpb`). Install it, drop in your
Algorand wallet, set spending limits, and Claude can discover paid services,
pay for them within your budget, and return the results in the chat.

It is a fork of [Pixa](https://github.com/soumyacodes007/Pixa) (MIT), trimmed to
Algorand-only and rewired so discovery reads the on-chain **ChainPeRegistry**
contract instead of Pixa's hosted marketplace.

## How it works

1. **`search_bazaar`** reads the ChainPeRegistry (Algorand app, default
   `757478481`) via the indexer and lists registered services with their price
   and endpoint.
2. **`x402_fetch`** calls a service endpoint; on `402 Payment Required` it signs
   a USDC payment on Algorand and retries — automatically.
3. A **spending tracker** enforces `MAX_PER_CALL` and `MAX_PER_DAY` (USDC)
   *before* any payment is signed.

Other tools: `check_balance`, `pay`, `transfer_usdc`, `transfer_algo`,
`spending_report`, `request_funding`, `tinyman_swap`, `create_token`.

## Configuration

Set via the Claude Desktop config form (or env vars when run directly):

| Field | Env var | Default |
|---|---|---|
| Algorand mnemonic (25 words) | `ALGORAND_MNEMONIC` | — (read-only if unset) |
| Network (`algorand` / `algorand-testnet`) | `NETWORK` | `algorand-testnet` |
| Max USDC per payment | `MAX_PER_CALL` | `0.10` |
| Max USDC per day | `MAX_PER_DAY` | `20.00` |
| ChainPe registry app id | `CHAINPE_REGISTRY_APP_ID` | `757478481` |

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
`search_bazaar` to read the live testnet registry.
