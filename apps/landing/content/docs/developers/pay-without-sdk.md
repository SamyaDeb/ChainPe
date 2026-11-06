---
title: Pay without the SDK
description: Answer a 402 by hand, so you can build a client in any language.
---

The protocol is plain HTTP and one signature. If your language can do EIP-712 signing, it can pay. The code below is TypeScript with [viem](https://viem.sh) only, to show every step. We ran it against the live demo: a correct signature reaches Circle's funds check, and a corrupted one gets `invalid_exact_evm_payload_signature`.

This covers the `exact` rail. For Gateway, use Circle's `@circle-fin/x402-batching`, or the [SDK](/docs/developers/sdk).

## The whole client

```ts
import { privateKeyToAccount } from 'viem/accounts'
import { randomBytes } from 'node:crypto'

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`)
const url = 'https://chainpe-arc-demo-production.up.railway.app/forecast?city=Mumbai'
const MAX_ATOMIC = 20_000n // $0.02. Always cap what you'll pay.

// 1. Ask. A 402 tells you the price.
const first = await fetch(url)
if (first.status !== 402) throw new Error(`Expected 402, got ${first.status}`)
const required = JSON.parse(
  Buffer.from(first.headers.get('payment-required')!, 'base64').toString()
)

// 2. Pick the normal USDC option, on the network you expect.
const option = required.accepts.find(
  (a: any) => a.extra?.name === 'USDC' && a.network === 'eip155:5042002'
)
if (!option) throw new Error('No exact option on Arc testnet')
if (BigInt(option.amount) > MAX_ATOMIC) throw new Error(`Too expensive: ${option.amount}`)

// 3. Sign a transfer of exactly that amount.
const now = Math.floor(Date.now() / 1000)
const authorization = {
  from: account.address,
  to: option.payTo,
  value: option.amount,
  validAfter: String(now - 600),
  validBefore: String(now + option.maxTimeoutSeconds),
  nonce: `0x${randomBytes(32).toString('hex')}` as `0x${string}`,
}

const signature = await account.signTypedData({
  domain: {
    name: option.extra.name,
    version: option.extra.version,
    chainId: Number(option.network.split(':')[1]),
    verifyingContract: option.asset,
  },
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'TransferWithAuthorization',
  message: {
    ...authorization,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
  },
})

// 4. Send the same request again, with the payment attached.
const header = Buffer.from(
  JSON.stringify({
    x402Version: 2,
    resource: required.resource,
    accepted: option,
    payload: { signature, authorization },
  })
).toString('base64')

const paid = await fetch(url, { headers: { 'PAYMENT-SIGNATURE': header } })

// 5. Read the result.
if (paid.status === 402) {
  const { reason } = await paid.json()
  throw new Error(`Payment refused: ${reason}`)
}
const receipt = JSON.parse(
  Buffer.from(paid.headers.get('payment-response')!, 'base64').toString()
)
console.log('tx:', receipt.transaction)
console.log('data:', await paid.json())
```

## Porting checklist

Getting one of these wrong gives you `invalid_exact_evm_payload_signature`:

| Item | Correct value |
|---|---|
| Signing standard | EIP-712 typed data, not `personal_sign` |
| Domain `name`, `version` | From `extra`, which is `USDC` and `2`. Don't hard-code them |
| Domain `chainId` | A number, from `network` |
| Domain `verifyingContract` | `asset`, the USDC contract |
| `value`, `validAfter`, `validBefore` | `uint256` when signing, decimal **strings** in the JSON |
| `nonce` | 32 random bytes, hex with `0x`. New for every payment |
| `accepted` | The `accepts` entry, copied unchanged |
| Header encoding | Standard base64 of the JSON |

Three things to get right beyond the signature:

- **Amounts are atomic USDC, with 6 decimals.** `10000` is $0.01. Use big integers, not floats.
- **Cap the price before signing.** A server decides its own price, so never sign whatever it asks for.
- **Check `payTo` if you know who you expect to pay.** A signature can only pay that address, but the server chooses it.

## Reading the options

| You want | Filter `accepts` by |
|---|---|
| A normal payment | `extra.name === 'USDC'` |
| Gateway | `extra.name === 'GatewayWalletBatched'` |
| Arc testnet | `network === 'eip155:5042002'` |
| Arc mainnet | `network === 'eip155:5042'` |

Don't filter by `scheme`, because both rails say `exact`.

## Retrying

If a request fails with a network error or `settlement_pending`, **send the same header again**. The proxy recognises it, and won't charge twice. Signing a new payment for a call that may have gone through risks paying twice. See [retries and duplicates](/docs/concepts/payment-rails#retries-and-duplicates).

## Rating the seller

The `X-CHAINPE-AGENT-ID` response header holds the seller's ERC-8004 id. To rate it, call `giveFeedback` on the [Reputation registry](/docs/reference/networks#contracts). The [SDK](/docs/developers/sdk) wraps this as `cp.giveFeedback(agentId, score)`.
