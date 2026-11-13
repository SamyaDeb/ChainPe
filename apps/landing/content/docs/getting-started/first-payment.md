---
id: first-payment
title: First Payment Walkthrough
sidebar_position: 4
---

# First Payment Walkthrough

This page walks through exactly what happens when `cp.fetch()` or `cp.pay()` intercepts an HTTP 402 and settles a USDC micropayment on Avalanche.

## The HTTP 402 Payment Required flow

HTTP status `402 Payment Required` has been reserved since HTTP/1.1 but was never standardized for general use. The x402 protocol defines how to use it: a server returns `402` with a structured body that describes what payment is required, and the client attaches a payment header on the retry.

### Step-by-step

```
1. Client sends initial request
   GET /api/data HTTP/1.1

2. Server returns 402
   HTTP/1.1 402 Payment Required
   Content-Type: application/json

   {
     "x402Version": 1,
     "accepts": [{
       "scheme": "exact",
       "network": "avalanche",
       "asset": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",  // USDC on Avalanche C-Chain
       "maxAmountRequired": "10000",    // 0.01 USDC in atomic units (6 decimals)
       "payTo": "0xAbc123...",          // provider wallet
       "resource": "https://api.example.com/api/data"
     }],
     "agentId": "42"  // optional: provider's ERC-8004 agent identity
   }

3. SDK signs an EIP-3009 authorization
   - Reads maxAmountRequired from the accepted offer
   - Checks it does not exceed maxPerCall (constructor option)
   - Signs a USDC transferWithAuthorization with your private key:
       from: your wallet
       to: provider's payTo address
       value: 10000 (0.01 USDC)
       validAfter: now
       validBefore: now + 5 minutes
       nonce: random bytes32

4. SDK retries with X-PAYMENT header
   GET /api/data HTTP/1.1
   X-PAYMENT: <base64-encoded signed authorization>

5. Provider proxy submits payment to facilitator
   POST https://chainpe-facilitator-production.up.railway.app/settle
   {
     "paymentPayload": { ... signed authorization ... },
     "paymentRequirements": { ... the 402 body offer ... }
   }

6. Facilitator calls USDC.transferWithAuthorization on Avalanche
   - Gas paid by the facilitator's key (not your wallet)
   - Settlement: ~1-2 seconds (Avalanche C-Chain finality)
   - Returns: { success: true, transaction: "0xabc..." }

7. Provider returns 200 with X-PAYMENT-RESPONSE header
   HTTP/1.1 200 OK
   X-PAYMENT-RESPONSE: <base64-encoded settlement receipt>
   Content-Type: application/json

   { "data": "your response" }

8. SDK decodes X-PAYMENT-RESPONSE and returns PaidResult
   result.payment.txHash = "0xabc..."
   result.payment.amount = "0.01"
   result.payment.recipient = "0xAbc123..."
```

## EIP-3009: why it works gaslessly

EIP-3009 (`transferWithAuthorization`) allows a token holder to pre-authorize a transfer by signing a structured message off-chain. A third party (the facilitator) can then call `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)` on the USDC contract, which verifies the signature and executes the transfer in a single transaction.

This is why:
- The agent never submits an on-chain transaction
- The agent never needs AVAX for gas
- The facilitator submits the transaction and pays gas
- The signed authorization can only transfer the exact amount to the exact recipient

## Code walkthrough

Here is the minimal code that produces a first payment:

```ts
import { ChainPe } from '@chainpeavax/sdk'

// 1. Construct the client. This does NOT make any network requests.
const cp = new ChainPe({
  privateKey: '0xYOUR_PRIVATE_KEY',
  network: 'avalanche',
  maxPerCall: '0.05'  // refuse to pay more than 5 cents per call
})

// 2. Your wallet address (derived from the private key, no RPC call)
console.log('Paying from:', cp.getAddress())

// 3. Check USDC balance (one RPC call to the USDC contract)
const { usdc } = await cp.balance()
console.log('Balance:', usdc, 'USDC')

// 4. Make the paid call. This may or may not trigger a payment:
//    - If the endpoint returns 200 directly, no payment is made.
//    - If it returns 402, the SDK signs and retries.
const response = await cp.fetch('https://api.example.com/data')
const data = await response.json()
console.log('Data:', data)

// 5. For full payment metadata, use cp.pay() instead:
const result = await cp.pay('https://api.example.com/data')
if (result.payment) {
  console.log('Amount paid:', result.payment.amount, 'USDC')
  console.log('To:', result.payment.recipient)
  console.log('Avalanche tx:', result.payment.txHash)
}
```

## Verifying on Snowtrace

After a successful payment you will have a transaction hash. Paste it into Snowtrace:

```
https://snowtrace.io/tx/0xYOUR_TX_HASH
```

You should see:
- A `transferWithAuthorization` call on the USDC contract (`0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`)
- `From:` the facilitator's gas key (`0x8cC8dADfAd2D39659314106bAf4Da10B3BA38A36`)
- `To:` the USDC contract
- Internal transfer from your wallet to the provider's `payTo` address

## What can go wrong

| Error | Cause | Fix |
|---|---|---|
| `ChainPePaymentError: x402: server accepts [] but wallet is on fuji` | Network mismatch | Ensure both client and endpoint use `network: 'avalanche'` |
| `ChainPePaymentError: payment exceeds maxPerCall` | The price exceeds your configured cap | Raise `maxPerCall` in the constructor |
| `402` returned after payment | Facilitator could not settle | Ensure you have USDC on Avalanche C-Chain at your wallet address; check facilitator health at `/health` |
| `ChainPePaymentError: x402: failed to sign payment` | Invalid private key | Verify your key is 0x + 64 hex characters |
| `USDC allowance insufficient` | The EIP-3009 flow does not require prior `approve()` — this should not occur. If it does, check the x402 version | The SDK uses EIP-3009 which requires no prior allowance |

## Next steps

- [Concepts: x402 Protocol](../concepts/x402-protocol.md) — deeper dive into the payment protocol
- [SDK Reference](../sdk-reference/chainpe-sdk.md) — all `ChainPe` class methods
- [Payment Flows](../payment-flows/overview.md) — initiation, validation, settlement in detail
