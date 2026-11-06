---
title: Networks and addresses
description: Arc chain settings, contract addresses and Circle endpoints.
---

Use Arc testnet. Nothing has run on Arc mainnet yet.

## Arc

| Item | Mainnet | Testnet |
|---|---|---|
| CLI name | `arc` | `arc-testnet` |
| Chain ID | 5042 | 5042002 |
| CAIP-2 | `eip155:5042` | `eip155:5042002` |
| RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Explorer | https://explorer.arc.io | https://explorer.testnet.arc.io |
| Faucet | None | https://faucet.circle.com |

## Contracts

| Contract | Mainnet | Testnet |
|---|---|---|
| USDC (ERC-20, 6 decimals) | `0x3600000000000000000000000000000000000000` | same |
| ERC-8004 Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ERC-8004 Validation | `0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58` | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |
| Gateway Wallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| Gateway Minter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` |
| `ChainPeAccounts` | Not deployed | `0xD315322c9D83A6f50A04236A2a242e0259bfB580` |

## Circle endpoints

| Service | URL |
|---|---|
| Facilitator Service | `https://api.circle.com/v1/facilitator/x402` |
| Gateway, testnet | `https://gateway-api-testnet.circle.com` |
| Gateway, mainnet | `https://gateway-api.circle.com` |
| Discovery API | `https://api.circle.com/v2/x402/discovery/resources` |

## What's different about Arc

- **Gas is paid in USDC.** No other token is needed.
- **USDC has two precisions.** Gas accounting uses 18 decimals, and the ERC-20 interface uses 6. They share one balance, so use the ERC-20 interface for amounts.
- **Finality is under 1 second.** There's no need to wait for confirmations.
- **Fees are low and predictable.** The design target is about $0.001 per USDC transfer under normal load.
- **Set `maxFeePerGas` to at least 20 gwei.** Transactions below this floor are dropped with no error.
- **Sends to `address(0)` and blocklisted addresses revert.**

Details: [Arc docs](https://docs.arc.io).
