---
title: Payment rails
description: How exact and Gateway differ, which to use, and what can go wrong on each.
---

A rail is how a payment gets settled. ChainPe offers two by default, and the buyer picks one from the 402.

| | `exact` | `gateway` |
|---|---|---|
| **Moves money** | USDC on Arc, for each call | From a prepaid Circle Gateway balance |
| **Settled by** | Circle Facilitator Service | Circle Gateway, in batches |
| **Lowest price** | $0.01 | Below one cent. $0.001 is tested |
| **Buyer needs** | USDC in the wallet | A Gateway deposit |
| **Buyer pays gas** | No, Circle submits it | Once, for the deposit |
| **Seller receives** | USDC in the payout wallet | A Gateway balance to withdraw |
| **Your API runs after** | The payment is `completed` on-chain | Circle accepts it and locks the funds |
| **Receipt** | A transaction hash | A transfer id, with the hash later |
| **`extra.name` in the 402** | `USDC` | `GatewayWalletBatched` |

## Which should I offer?

**Sellers:** leave both on, which is the default. Set `--rails` only if you have a reason:

```bash
chainpe start --rails exact     # no Gateway, so every price must be at least $0.01
chainpe start --rails gateway   # nanopayments only
```

A route under $0.01 is offered on Gateway only. If Gateway is off too, the proxy refuses to start and names the route.

**Buyers:** the choice depends on how much you'll spend:

| You're making | Use | Why |
|---|---|---|
| A few calls, or trying something | `exact` | No deposit, and you get an on-chain receipt immediately |
| Many calls, or prices under a cent | `gateway` | The only option below $0.01, with no per-call on-chain transaction |

The CLI's `--rail auto` and the SDK's default both use Gateway when your deposit covers the price, and your wallet otherwise.

## Exact in detail

1. The buyer signs an EIP-3009 `TransferWithAuthorization` for exactly `amount`.
2. The proxy sends it to Circle's `POST /settle`, with a proof signed by the seller's key.
3. If Circle answers `settlement_pending`, the proxy polls every 500 ms for up to 20 seconds.
4. On `completed`, the proxy forwards to your API. On `failed`, the buyer gets a 402 and your API isn't called.

**Slow settlements.** If polling times out, the buyer gets a 402 with `settlement_pending`, and your API isn't called. Retrying with the **same signed payment** asks Circle for the outcome, and doesn't pay twice. The proxy remembers a pending payment for an hour, in memory.

## Gateway in detail

The buyer deposits once, then signs each payment with no gas:

```bash
chainpe deposit 1 --network arc-testnet     # an on-chain transaction
chainpe fetch "<url>" --rail gateway --max 0.01
```

```text
  ✓ 200
    Gateway payment: 393435a2-78e7-45c3-bfd8-9f85d7b87930 (settles in the next batch)
```

Circle locks the buyer's funds when it accepts a payment, and your API runs at that point. Waiting for the batch would hold each request for minutes. In our testnet sample the median was about 8 minutes.

**The risk this creates.** If a batch ever failed, the seller would have served that call and not been paid. The dashboard shows it as `failed` and keeps it out of revenue. The risk falls on the seller, and is small because the funds are locked first.

**Uncertain outcomes.** If Gateway doesn't answer within 15 seconds, the buyer gets a 402 with `gateway_unavailable`. The payment might have been accepted, so if the buyer retries the same signed payment, the proxy looks up that exact transfer and serves the call only if it finds a match. A replay from anyone else gets `nonce_already_used`.

## Retries and duplicates

The proxy identifies a payment by a hash of its signed payload, so it delivers each one at most once.

| A buyer sends | While | Result |
|---|---|---|
| The same signature again | It's still settling | `payment_in_progress`, and no second charge |
| The same signature again | It was already delivered | `payment_already_used`, and your API isn't called again |
| The same signature again | It's pending on Circle | The proxy asks Circle for the outcome |
| A new signature | Anything | A new payment |

**For client authors:** retry a failed call with the same signed payment, and sign a new one only when the first has definitely failed. To repeat a call that succeeded, sign a new payment.

This tracking is in memory, so it resets when the proxy restarts. Circle's own replay protection still applies. The on-chain nonce can't be used twice.

## Withdrawals

Sellers move Gateway earnings out with `chainpe withdraw <amount>` or `chainpe withdraw --all`. Check first with `chainpe balance`:

| Line | Meaning |
|---|---|
| `Gateway available` | Settled and ready to withdraw |
| `Gateway total` | Your whole Gateway balance |
| `Pending batch` | Accepted, but its batch hasn't landed |
| `On-chain USDC` | In your wallet. Mint gas comes from here |

**Costs, measured on testnet:** a fee of 0.0035 USDC on top of the amount, plus about 0.0027 USDC of gas for the mint. So **withdrawing less than about 0.0062 USDC loses money**. Circle doesn't publish the fee and has no API for it, and mainnet may differ.

`--all` handles the fee for you, by withdrawing the balance minus the fee. A specific amount needs the fee available on top, or you get `Withdrawal needs ... USDC available`.

To withdraw to another chain Gateway supports, use `--chain <name>`.
