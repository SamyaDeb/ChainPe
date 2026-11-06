---
title: Configuration
description: The CLI config file and environment variables.
---

## Config file

`chainpe init` writes `~/.chainpe/config.json`. To use another file, set `CHAINPE_CONFIG`.

| Field | Meaning |
|---|---|
| `serviceName`, `serviceDescription`, `tags` | How your service is described |
| `targetUrl` | Your API, which only the proxy calls |
| `pricePerRequest` | The default price, in USDC, such as `"0.01"` |
| `walletAddress` | The wallet that receives payments |
| `proxyPort` | The proxy's port. The default is 4402 |
| `network` | `arc-testnet` or `arc` |
| `rails` | Payment rails to accept. The default is all of them |
| `routes` | Routes with their own price and description |
| `publicUrl` | The HTTPS address buyers connect to. This is the proxy, not `targetUrl` |

## Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `CHAINPE_NETWORK` | CLI | `arc-testnet` or `arc` |
| `CHAINPE_SELLER_PRIVATE_KEY` | CLI | Payout key. It signs seller proofs and Gateway withdrawals |
| `CHAINPE_PRIVATE_KEY` | CLI, MCP wallet | Buyer key |
| `CIRCLE_API_KEY` | CLI | Circle account key, once the keyless trial is used up |
| `CIRCLE_FACILITATOR_URL` | CLI | Overrides Circle's Facilitator URL |
| `CIRCLE_GATEWAY_URL` | CLI | Overrides the Gateway URL. The default follows the network |
| `CHAINPE_ACCOUNTS_ADDRESS` | CLI, SDK, MCP wallet | `ChainPeAccounts` address |
| `ERC8004_REPUTATION_REGISTRY` | SDK, MCP wallet | Ratings registry |
| `CHAINPE_CLOUD_URL` | CLI | The cloud API's URL |
| `CHAINPE_INGEST_KEY` | CLI | The key that `chainpe login` issues |
| `ARC_RPC_URL`, `ARC_TESTNET_RPC_URL` | CLI | RPC overrides |

Never commit a private key. Keep it in `.env`, which git ignores, or in your host's secret settings.
