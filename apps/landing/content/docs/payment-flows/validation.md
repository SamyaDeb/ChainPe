---
id: payment-validation
title: Payment Validation
sidebar_position: 3
---

# Payment Validation

After the proxy receives a request with an `X-PAYMENT` header, it calls the facilitator's `/verify` endpoint before committing to on-chain settlement.

## Verify endpoint

```
POST https://chainpe-facilitator-production.up.railway.app/verify
Content-Type: application/json

{
  "paymentPayload": { ... signed x402 payload ... },
  "paymentRequirements": { ... the offer from the 402 response ... }
}
```

### What verify checks

The `x402` library's `verify()` function (which ChainPe wraps) performs:

1. **Schema validation** — both payload and requirements pass `PaymentPayloadSchema.parse()` and `PaymentRequirementsSchema.parse()` (Zod schemas)
2. **Version check** — `x402Version` must match
3. **Scheme check** — `scheme` must be `"exact"`
4. **Network check** — `network` must match the facilitator's configured network
5. **Asset check** — `asset` must be the canonical USDC address for the network
6. **Amount check** — `value` must equal `maxAmountRequired`
7. **Expiry check** — `validBefore` must be in the future
8. **Signature verification** — recovers `from` from the EIP-3009 signature using `verifyTypedData`; the recovered address must match `authorization.from`
9. **Nonce uniqueness** — checks that this nonce has not been used for this `from` address

### Response

```json
{ "isValid": true }
```

Or on failure:
```json
{
  "isValid": false,
  "invalidReason": "invalid_signature"
}
```

### When verify is skipped

The `x402-express` middleware calls `verify` then `settle` in sequence. Some proxy configurations call `settle` directly (which calls `verify` internally). In ChainPe's current implementation, the proxy calls `settle` directly, which calls `verify` as part of the settlement flow.

## On-chain verification (USDC contract)

The final verification happens on-chain when the facilitator calls `transferWithAuthorization`. The USDC contract independently verifies:

1. The EIP-3009 signature (using `ecrecover`)
2. That `from` has sufficient USDC balance
3. That `validAfter <= block.timestamp < validBefore`
4. That the nonce has not been used (the USDC contract maintains a bitmap of used authorization nonces)

If any of these fail, the `transferWithAuthorization` call reverts and the settlement fails. The proxy returns a second `402` to the client in this case, surfaced as a `ChainPePaymentError` with `reason: 'settlement_rejected'`.
