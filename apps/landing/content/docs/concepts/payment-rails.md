---
title: Payment rails
description: The two ways an agent can pay, and when each one fits.
---

ChainPe offers two ways to pay, and the agent picks one.

| | `exact` | `gateway` |
|---|---|---|
| How it works | Moves USDC on Arc for each call | Pays from a prepaid Circle Gateway balance |
| Settled by | Circle Facilitator Service | Circle Gateway, in batches |
| Prices | From $0.01 | Below one cent too, such as $0.001 |
| Buyer needs | USDC in the wallet | A Gateway deposit |
| Seller receives | USDC in the payout wallet | A Gateway balance to withdraw |
| Your API runs after | The payment is `completed` | Circle accepts the payment and locks the funds |

Routes priced under $0.01 need Gateway, because on-chain settlement costs make `exact` pointless at that price.

## Exact

The buyer signs a USDC transfer. The proxy sends it to Circle's Facilitator Service, which submits it on Arc and pays the gas. The proxy waits until the payment is `completed`, and never forwards a request on `pending`.

## Gateway

The buyer deposits USDC into Gateway once, then signs each payment with no gas:

```bash
chainpe deposit 1 --network arc-testnet
chainpe fetch "<url>" --network arc-testnet --rail gateway --max 0.01
```

Circle locks the buyer's funds when it accepts a payment, and your API runs at that point. The batch lands on Arc later, a median of about 8 minutes in our testnet sample.

If a batch ever failed, the seller would have served that call for free. The dashboard marks such a payment as failed.

## Withdrawals

Sellers move Gateway earnings out with `chainpe withdraw <amount>` or `chainpe withdraw --all`. Earnings become available once their batch has settled.

Each withdrawal has a fee on top of the amount, plus a little gas for the mint. On testnet we saw a fee of 0.0035 USDC and about 0.0027 USDC of gas, so withdrawing less than about 0.0062 USDC loses money. Circle doesn't publish the fee, and it may differ on mainnet.
