# Spec 02 — Settle through Circle Facilitator Service

**Goal:** `exact` payments on Arc settle through Circle, using the seller's own key for the seller
proof. ChainPe stops running its own facilitator for Arc.

## Use the SDK — don't hand-roll

`@circle-fin/x402-batching@4.0.0` (`/server`) already ships:

- `CircleFacilitatorClient` — implements x402 `FacilitatorClient` (verify/settle/supported/status),
  signs `Facilitator-Seller-Proof` per request.
  - keyless: `new CircleFacilitatorClient({ sellerSigner: privateKeyToAccount(key) })`
  - registered: `new CircleFacilitatorClient({ apiKey: process.env.CIRCLE_API_KEY, sellerSigner })`
- `createFacilitatorMiddleware({ sellerSigner, apiKey?, networks, facilitatorUrl?, verifyBeforeSettle? })`
  with `.require('$0.01')`, hooks, and `getStatus(paymentId, { network })`.
- Helpers: `createSellerProof`, `isSettlementPending`, constants `FACILITATOR_URL`
  (`https://api.circle.com/v1/facilitator/x402`), `FACILITATOR_SELLER_PROOF_HEADER`.

## Protocol facts (Circle quickstart)

- `POST /settle` for `exact` (no separate verify needed; settle re-checks everything).
- Response is HTTP 200 for both outcomes: `success: true` with `transaction`, `payer`, `network`, `amount`;
  or `success: false, errorReason: "settlement_pending"` with `extensions["settlement-status"].paymentId`.
- Pending → poll `GET /status/{paymentId}` (fresh `status` proof) until `completed` or `failed`.
  **Never serve on pending.**
- Idempotency: `extensions["payment-identifier"].info.id`, 16–128 chars `[A-Za-z0-9_-]`. Retries reuse it; never re-sign.
- Seller proof: EIP-712 `SellerRequest {purpose, method, bodyHash, network, payTo, nonce, issuedAt, expiresAt}`,
  domain `Circle Facilitator Seller Request` v1, chainId = network chain id, TTL 300 s.
- Keyless trial: per-`payTo`, per-network allowance (testnet and mainnet counted separately); when used up,
  `/settle` → 403 `registration_required`; one settle with an API key binds the seller account.

## ChainPe integration

New file `packages/chainpe/src/proxy/circleFacilitator.ts`:

```ts
import { CircleFacilitatorClient } from '@circle-fin/x402-batching/server'
export function circleFacilitator(cfg: ChainPeConfig, sellerKey: `0x${string}`) {
  return new CircleFacilitatorClient({
    sellerSigner: privateKeyToAccount(sellerKey),
    apiKey: process.env.CIRCLE_API_KEY,          // optional on testnet trial
    facilitatorUrl: process.env.CIRCLE_FACILITATOR_URL, // default FACILITATOR_URL
  })
}
```

- Seller key source: `CHAINPE_SELLER_PRIVATE_KEY` env, else the CLI keychain (`chainpe init` stores it like `chainpe-agent/src/keychain.ts`). Its address MUST equal `walletAddress` (`payTo`); refuse to start otherwise.
- `facilitatorUrl` in config is ignored for `arc*` unless `--facilitator-url` is passed explicitly.
- Map `registration_required` to a clear CLI error: "Circle trial allowance used up — set CIRCLE_API_KEY".
- Pending handling: poll status every 500 ms for up to 20 s (configurable); on timeout return 402 with
  `reason: settlement_pending` and log the paymentId for reconciliation.

## Acceptance

- [ ] Unit: payTo ≠ signer address → startup error.
- [ ] Integration (Arc testnet): paid call returns 200, `PAYMENT-RESPONSE` contains the tx hash, tx visible on explorer.
- [ ] Simulated pending (mock client) → backend not called; client gets 402 `settlement_pending`.
- [ ] Retry with the same payment-identifier does not double-charge (mock).
