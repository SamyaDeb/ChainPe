---
id: payment-initiation
title: Payment Initiation
sidebar_position: 2
---

# Payment Initiation

The initiation phase covers everything from the agent's first request to the moment it signs the USDC authorization.

## Initial request

The agent sends a standard HTTP request with no payment header:

```http
GET /api/data HTTP/1.1
Host: api.example.com
Accept: application/json
```

## Server response: 402

The x402-protected endpoint returns a `402 Payment Required` with a structured body:

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "avalanche",
      "asset": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
      "maxAmountRequired": "10000",
      "payTo": "0xProviderWalletAddress",
      "resource": "https://api.example.com/api/data",
      "description": "Weather data, per query"
    }
  ],
  "agentId": "42"
}
```

ChainPe's proxy also sets the `X-CHAINPE-AGENT-ID` response header with the provider's ERC-8004 agent id. This lets the SDK skip a registry scan when posting reputation feedback after payment.

## Offer selection

The SDK iterates `accepts` and selects the offer matching its configured network:

```ts
const accept = body.accepts.find(a => X402_TO_NETWORK[a.network] === this.network)
```

If no matching offer is found, the SDK throws with a clear error listing the available networks.

## maxPerCall guard

Before signing, the SDK checks the price against the configured `maxPerCall`:

```ts
const required = BigInt(accept.maxAmountRequired)
if (required > this.maxPerCallAtomic) {
  throw new ChainPePaymentError(
    `x402: payment of ${formatUnits(required, 6)} USDC exceeds maxPerCall ...`
  )
}
```

This prevents unexpected spend if a service raises its price without the agent's knowledge.

## Signing the EIP-3009 authorization

The SDK calls `createPaymentHeader` from the `x402` library, which internally calls `USDC.transferWithAuthorization`. The signed message contains:

```ts
{
  from: agentWallet,        // who authorizes the transfer
  to: accept.payTo,         // provider's wallet (the 402 payTo)
  value: accept.maxAmountRequired,  // exact amount
  validAfter: 0,            // can be submitted immediately
  validBefore: now + 300s,  // expires in 5 minutes
  nonce: randomBytes32()    // single-use
}
```

The private key never leaves the agent's process. The signature authorizes exactly this amount to exactly this recipient — the facilitator cannot redirect funds.

## Building the X-PAYMENT header

The signed authorization is base64-encoded into the `X-PAYMENT` request header:

```http
GET /api/data HTTP/1.1
Host: api.example.com
X-PAYMENT: <base64-encoded signed x402 payload>
```

The SDK then retries the original request with this header attached.

## Timeout behavior

Each request has a configurable timeout (default: 30 seconds). The SDK wraps each `fetch` call with an `AbortController`:

```ts
const ctrl = new AbortController()
const timer = setTimeout(() => ctrl.abort(), timeout)
fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer))
```

Pass `timeout` in `FetchOptions` to override per-request.
