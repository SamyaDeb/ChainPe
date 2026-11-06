---
title: Configuration
description: Every config field and environment variable, and which one wins.
---

## Where settings come from

The CLI config is a JSON file, and secrets stay in the environment.

**Config file:** `~/.chainpe/config.json`, or the path in `CHAINPE_CONFIG`. It's saved with `0600` permissions, because it can hold your ingest key.

**Environment:** the CLI loads a `.env` file **from the current folder** at startup. A variable already set in your shell wins over `.env`. If the CLI uses a key you didn't expect, check `.env` first.

**Network** is resolved in this order: `--network`, then `CHAINPE_NETWORK`, then the config's `network`.

## Config fields

| Field | Required | Meaning |
|---|---|---|
| `serviceName` | Yes | Your service's name, and part of its on-chain key. Renaming creates a new listing |
| `serviceDescription` | Yes | What a buyer gets. Aim for 160 characters or more |
| `tags` | Yes | A list, for discovery. Can be empty |
| `targetUrl` | Yes | Your API. Only the proxy should be able to reach it |
| `pricePerRequest` | Yes | The default price in USDC, such as `"0.01"`. At most 6 decimals |
| `paymentToken` | Yes | Always `"USDC"` |
| `walletAddress` | Yes | Receives payments. The seller key must match it |
| `proxyPort` | Yes | The port to listen on. `--port` overrides it |
| `network` | Yes | `arc-testnet` or `arc` |
| `publicUrl` | To register | The HTTPS address of the proxy. Published on-chain |
| `routes` | To list | Priced routes, see below |
| `rails` | No | `["exact", "gateway"]` by default |
| `agentId` | No | Your ERC-8004 id. `chainpe identity` sets it |
| `category` | No | Circle Discovery category, used by `chainpe doctor` |
| `logLevel` | No | `verbose`, `normal` or `quiet` |
| `adminKey` | No | Lets remote callers read `/chainpe-admin` |

### Routes

```json
{
  "path": "GET /weather",
  "pricePerRequest": "0.001",
  "paymentToken": "USDC",
  "description": "Current weather for a city",
  "query": { "city": "City name, for example London" }
}
```

| Field | Meaning |
|---|---|
| `path` | `"METHOD /path"`, or `"/path"` for any method. Methods are GET, POST, PUT, PATCH and DELETE |
| `pricePerRequest` | The route's price. Under $0.01 means Gateway only |
| `paymentToken` | Always `"USDC"` |
| `description` | Shown in the 402 and your OpenAPI document |
| `query` | Query parameters, name to description, documented by `chainpe doctor` |

A wildcard route works for charging, but can't be documented, so `chainpe doctor` fails it.

## Environment variables

### Selling

| Variable | Default | Meaning |
|---|---|---|
| `CHAINPE_SELLER_PRIVATE_KEY` | Required | The payout wallet's key. Signs settlement proofs, withdrawals and registrations |
| `CHAINPE_CONFIG` | `~/.chainpe/config.json` | The config file. Generated documents go next to it |
| `CHAINPE_NETWORK` | The config's | `arc-testnet` or `arc` |
| `CHAINPE_AGENT_ID` | The config's | Overrides the advertised ERC-8004 id |
| `CIRCLE_API_KEY` | None | Your Circle key, once the keyless trial is used up |
| `CIRCLE_FACILITATOR_URL` | Circle's | Overrides the Facilitator URL |
| `CIRCLE_GATEWAY_URL` | Follows the network | Overrides the Gateway URL |
| `CHAINPE_CLOUD_URL` | The hosted API | The dashboard API. Set this on a hosted proxy |
| `CHAINPE_INGEST_KEY` | From `chainpe login` | Lets a proxy report payments. Set this on a hosted proxy |
| `CHAINPE_ACCOUNTS_ADDRESS` | The deployed contract | `ChainPeAccounts` |

### Buying

| Variable | Used by | Meaning |
|---|---|---|
| `CHAINPE_PRIVATE_KEY` | CLI, MCP wallet | The buyer's key |
| `CHAINPE_ACCOUNTS_ADDRESS` | SDK, MCP wallet | `ChainPeAccounts` |
| `ERC8004_REPUTATION_REGISTRY` | SDK, MCP wallet | Ratings registry |
| `NETWORK`, `ALLOW_MAINNET` | MCP wallet | See [MCP wallet](/docs/developers/mcp-wallet#configuration) |
| `MAX_PER_CALL`, `MAX_PER_DAY`, `RAILS` | MCP wallet | Spending limits and rails |

### Both

| Variable | Default | Meaning |
|---|---|---|
| `ARC_TESTNET_RPC_URL` | `https://rpc.testnet.arc.io` | RPC override |
| `ARC_RPC_URL` | `https://rpc.mainnet.arc.io` | RPC override |

The public RPC is rate-limited. Use your own for anything heavy.

## Keeping keys safe

- Never commit a private key, or put it in a Docker image. `.env` is ignored by git in this repo, but check your own.
- Use separate wallets for selling and buying.
- The CLI never prints keys. It does print addresses, which are public.
