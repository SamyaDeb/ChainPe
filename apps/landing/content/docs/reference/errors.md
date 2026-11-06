---
title: Errors
description: Every payment failure and error message, what it means, and how to fix it.
---

**The key question after any failure is whether you were charged.** A `402` means you weren't, and the API wasn't called. Any other status after a payment means you were.

## Payment refused

These arrive as a `402` with this body, and in the `errorReason` field of `PAYMENT-RESPONSE`:

```json
{ "error": "payment_failed", "reason": "insufficient_funds", "message": "insufficient_funds" }
```

### Buyer's side

| Reason | Rail | Meaning | Fix |
|---|---|---|---|
| `insufficient_funds` | `exact` | The wallet has too little USDC | Top up, or wait for the faucet drop |
| `insufficient_balance` | Gateway | The Gateway deposit is too low | `chainpe deposit` or `cp.depositGateway()` |
| `invalid_exact_evm_payload_signature` | `exact` | The signature doesn't match the payment | Check [the porting checklist](/docs/developers/pay-without-sdk#porting-checklist) |
| `nonce_already_used` | Gateway | This signed payment was already used | Sign a new one |
| `payment_already_used` | Both | The proxy already delivered this payment | Sign a new one to call again |
| `payment_in_progress` | Both | The same payment is settling right now | Wait, then retry the same payment |

### Temporary

Retry these with the **same** signed payment. You won't be charged twice.

| Reason | Rail | Meaning |
|---|---|---|
| `settlement_pending` | `exact` | Circle hasn't finished within 20 seconds. Retrying asks for the outcome |
| `gateway_unavailable` | Gateway | Gateway didn't answer. The payment may or may not have been accepted |
| `gateway_not_final` | Gateway | Gateway reported success with no transfer id |
| `unexpected_error` | Gateway | A server error at Gateway. The outcome is unknown |
| `facilitator_unavailable` | `exact` | The proxy couldn't reach Circle |

### Seller's side

| Reason | Meaning | Fix (seller) |
|---|---|---|
| `registration_required` | The Circle keyless trial is used up for this payout wallet | Set `CIRCLE_API_KEY` and restart |
| `rail_not_enabled` | The buyer used a rail the proxy has off | Enable it with `--rails`, or the buyer picks the other |
| `settlement_failed` | Circle reported the payment as failed | Check Circle's status, and retry with a new payment |
| `facilitator_error`, `gateway_rejected` | Circle refused it with no specific reason | Check the proxy's logs |

Circle may return reasons not listed here, and the proxy passes them on unchanged.

## CLI messages

### `chainpe fetch`

| Message | Meaning | Fix |
|---|---|---|
| `rejected by spendControls.allowedAssets maxAmountPerPayment` | The price is above `--max`. **Nothing was signed** | Raise `--max` if you accept the price |
| `filtered out by policies` | The route has no option on your `--rail` | Often a route under $0.01 with `--rail exact`. Use `--rail gateway` |
| `No wallet key. Pass --key 0x… or set CHAINPE_PRIVATE_KEY` | No buyer key | Set the variable, or add it to `.env` |
| `Payment:  none made` | The URL didn't charge | Nothing to fix |

### `chainpe start`

| Message | Fix |
|---|---|
| `No configuration found` | Run `chainpe init`, or set `CHAINPE_CONFIG` |
| `CHAINPE_SELLER_PRIVATE_KEY is not set` | Export the payout wallet's key |
| `Seller key address … does not match walletAddress` | The key isn't the payout wallet's. Check `.env` in the current folder too, because it's loaded automatically |
| `Arc mainnet takes real USDC…` | Use `--network arc-testnet`, or pass `--allow-mainnet` to accept the risk |
| `Route … costs $…: exact needs at least $0.01` | Raise the price, or enable the `gateway` rail |
| `Circle Gateway is not available at …` | Retry, or run with `--rails exact` |
| `Facilitator does not support exact payments on …` | Check your network, or use `--rails gateway` |

### `chainpe identity`, `register`

| Message | Fix |
|---|---|
| `No publicUrl in the config` | Add the proxy's HTTPS address |
| `publicUrl must use https` | Use HTTPS. `--allow-http` works on testnet only |
| `publicUrl is your backend (targetUrl)` | Publish the proxy's address, or buyers can skip payment |
| `publicUrl host … is private` | Use a public address |
| `… is … bytes, but must be …` | A field is too long or short for the contract. Shorten it in your config |

### `chainpe withdraw`

| Message | Fix |
|---|---|
| `Pass either an amount or --all` | Choose one |
| `Nothing to withdraw` | Earnings may still be in a pending batch. Check `chainpe balance` |
| `Withdrawal needs … USDC available (amount + fee)` | Withdraw less, or use `--all` |

### `chainpe login`

It refuses to sign anything unexpected: `Refused to sign: the message is for …` means the server's sign-in message didn't match this API, chain or wallet. Check `CHAINPE_CLOUD_URL`.

## SDK errors

See [handling errors](/docs/developers/sdk#handling-errors).

| Thrown | `reason` | Meaning |
|---|---|---|
| `ChainPePaymentError` | Any reason above | The server refused a signed payment |
| `ChainPePaymentError` | `no_usable_rail` | No option on your `rails` that you can pay |
| `Error` | | `exceeds maxPerCall`. Nothing was signed |
| `Error` | | `does not accept payment on <network>` |

## Cloud API errors

Every error is `{ "error": "<code>", "message": "..." }`.

| HTTP | `error` | Meaning | Fix |
|---|---|---|---|
| 400 | `invalid_request` | The body failed validation | Read `message` |
| 401 | `unauthorized` | Missing or expired token or key | Sign in again. Sessions last 12 hours |
| 401 | `invalid_siwe` | Wrong domain, URI, chain or address, or a bad or used nonce | Get a new nonce |
| 403 | `not_registered` | This wallet has no provider account | `chainpe register` |
| 403 | `plan_required` | That needs Pro | `chainpe upgrade` |
| 403 | `pay_to_mismatch` | An event pays a wallet this key doesn't own. The whole batch is refused | Don't retry it |
| 403 | `service_not_owned` | The service isn't this provider's | Check `serviceKey` |
| 400 | `wrong_network` | An event names another network | Check `network` |
| 404 | `not_found` | No such resource | |
| 409 | `too_many_keys` | 10 active ingest keys | Revoke one |
| 413 | `payload_too_large` | Over 500 events or 1 MB | Send smaller batches |
| 429 | `rate_limited` | Too many requests | Back off |
| 503 | `chain_unavailable` | Arc couldn't be read. **It doesn't mean you're unregistered** | Retry |
| 500 | `internal_error` | A server error | Retry |

## Contract errors

`ChainPeAccounts` reverts with these named errors:

| Error | Meaning |
|---|---|
| `ProviderAlreadyExists` | This wallet already has an account |
| `ProviderNotFound` | Register a provider first |
| `NotAgentOwner` | Your wallet doesn't own that ERC-8004 id |
| `ServiceAlreadyActive` | A service with this name is already active. Use `updateService` |
| `ServiceNotFound`, `ServiceNotActive` | No such service, or it's inactive |
| `ServiceLimitReached` | Your plan's limit: 1 on Free, 10 on Pro |
| `InvalidStringLength` | A field is too long or too short |
| `PayToNotSender` | `payTo` must be your own wallet |
| `NoPaymentRail` | A service must accept at least one rail |
| `InvalidPeriods` | `subscribe` takes 1 to 12 periods |
| `ZeroPrice`, `ZeroAddress` | A price or address was empty |
| `RenounceDisabled` | Ownership can't be renounced |

The CLI runs these checks first, and shows them as plain messages.
