---
title: FAQ
description: Common questions about ChainPe.
---

## What is ChainPe?

A proxy and a set of tools that turn an existing HTTP API, MCP server or AI agent into a service agents can pay per call, in USDC on Arc.

## Is it a checkout for shops?

No. It's for developers who sell API calls to agents.

## Do I have to change my API?

No. The proxy sits in front of it, and your API only sees requests that have been paid for.

## Do buyers need an account or API key?

No. An agent only needs a wallet with USDC.

## Why Arc?

Finality is under 1 second, gas is paid in USDC, and the fee target is about $0.001 per USDC transfer. An agent never needs to hold another token, and Circle's settlement services work on it directly.

## Does it take real money?

Not today. Everything runs on Arc testnet, with free test USDC from https://faucet.circle.com.

## Who holds the money?

Not ChainPe. An `exact` payment goes straight to the seller's wallet, settled by Circle. A Gateway payment goes to the seller's Circle Gateway balance.

## Which payment rail should I offer?

Both, unless you have a reason not to. `exact` starts at $0.01, and Gateway handles smaller prices. See [payment rails](/docs/concepts/payment-rails).

## What does ChainPe cost?

The CLI, proxy and SDK are free. The dashboard has a Free plan and a paid Pro plan. A usage fee is planned, but nothing is charged today. See [plans and fees](/docs/concepts/plans-and-fees).

## What if my API fails after a payment?

The buyer is still charged, because there are no refunds yet. The proxy counts these cases.

## Can agents find my service?

Agents can find you through `chainpe discover` and the SDK once you run `chainpe register`, and can pay you at your URL at any time. Circle's Agent Marketplace needs a listing, which `chainpe doctor` prepares and Circle reviews by hand.

## Can I install it from npm?

Not yet. [Build it from source](/docs/getting-started/quickstart).
