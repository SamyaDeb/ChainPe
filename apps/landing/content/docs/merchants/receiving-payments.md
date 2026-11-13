---
id: merchant-receiving-payments
title: Receiving Payments
sidebar_position: 4
---

# Receiving Payments

As a merchant, you receive USDC directly to your `payTo` wallet after every settled API call. No withdrawal process, no platform fee, no intermediary.

## How USDC arrives

When a client successfully pays for your API:

1. The facilitator calls `USDC.transferWithAuthorization(from=client, to=yourPayTo, value=amount, ...)`
2. The Avalanche C-Chain confirms the transfer in ~1-2 seconds
3. Your `payTo` wallet balance increases by `amount` USDC
4. Your backend receives the proxied request and returns its response

The USDC is in your wallet immediately after the settlement transaction confirms. There is no escrow, no hold period, and no minimum payout threshold.

## Viewing earnings via admin endpoints

The x402 proxy tracks payments in memory and exposes admin endpoints:

```bash
# All-time stats
curl http://localhost:4402/chainpe-admin/stats

# Recent payment history
curl http://localhost:4402/chainpe-admin/payments
```

Stats response:
```json
{
  "totalRequests": 1042,
  "successfulPayments": 987,
  "failedPayments": 55,
  "revenue": {
    "USDC": "9.87"
  }
}
```

:::note
These stats are in-memory and reset when the proxy restarts. For persistent earnings tracking, query your wallet balance on Snowtrace or set up a custom event listener on the USDC contract filtered to your `payTo` address.
:::

## Protecting admin endpoints

If you expose the proxy publicly, protect the admin endpoints with an admin key:

In `~/.chainpe/config.json`:
```json
{
  "adminKey": "your-secret-admin-key"
}
```

Then pass the key in the header:
```bash
curl -H "X-Admin-Key: your-secret-admin-key" http://localhost:4402/chainpe-admin/stats
```

## Viewing on-chain USDC balance

```bash
# Using the ChainPe CLI (reads your configured wallet balance)
chainpe status

# Or using the SDK
import { ChainPe } from '@chainpeavax/sdk'
const cp = new ChainPe({ privateKey: process.env.KEY!, network: 'avalanche' })
const { usdc } = await cp.balance()
console.log(`USDC earned: ${usdc}`)
```

## On Snowtrace

Every settled payment is a USDC `transferWithAuthorization` call on Avalanche. To see all incoming payments to your wallet:

1. Go to https://snowtrace.io
2. Search for your `payTo` address
3. Filter by "ERC-20 Token Txns" — all USDC transfers appear here

## ERC-8004 reputation

Every client that pays for your API can rate your service. Ratings accumulate in the `ReputationRegistry` and are shown in `cp.discover()` results and the marketplace dashboard. A higher reputation score means your service appears higher in ranked discovery results — which drives more traffic.

To view your current reputation:
```bash
# Via the indexer
curl https://chainpe-indexer-production.up.railway.app/services/youraddress:yourservicename/reputation
```
