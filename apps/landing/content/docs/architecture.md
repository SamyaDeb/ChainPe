---
title: Architecture
description: What ChainPe runs, what Circle runs, and what lives on Arc.
---

ChainPe owns the proxy, the client tools, the provider accounts contract, the cloud API and the dashboard. Circle owns settlement, nanopayments and discovery. Arc holds the money and the ratings.

| Where | Component | What it does |
|---|---|---|
| Buyer | SDK, AI tools, MCP wallet or CLI | Finds services, signs payments, rates providers |
| Provider's machine | ChainPe proxy | Answers 402, settles through Circle, then calls the API |
| Provider's machine | Your API | Runs unchanged |
| Circle | Facilitator Service | Settles `exact` payments on Arc |
| Circle | Gateway | Settles nanopayments in batches |
| Circle | Discovery API | Lets agents find listed services |
| ChainPe cloud | `chainpe-cloud` | Sign-in, proxy reports, Arc indexing, verified revenue |
| ChainPe cloud | Dashboard | Shows each provider their own data |
| Arc | USDC | The money, and the gas |
| Arc | ERC-8004 registries | Identities and ratings |
| Arc | `ChainPeAccounts` | Provider accounts, listings and plans |

## A paid call on the `exact` rail

1. The buyer calls the proxy and gets `402` with the payment options.
2. The buyer signs a USDC transfer and retries with `PAYMENT-SIGNATURE`.
3. The proxy calls Circle's `POST /settle`, with a seller proof signed by the payout key.
4. Circle submits the transfer on Arc. If it answers pending, the proxy polls until it completes.
5. The proxy forwards the request to your API.
6. The buyer gets the answer, with `PAYMENT-RESPONSE`.
7. The proxy reports the payment to `chainpe-cloud`, which matches it to the USDC transfer on Arc.

On the Gateway rail the shape is the same, but settling means Circle accepts the payment and locks the funds. Funds land in the seller's Gateway balance, and `chainpe withdraw` moves them on-chain.

## Registration and sign-in

1. `chainpe identity` mints an ERC-8004 identity on Arc.
2. `chainpe register` creates the provider account and the service on `ChainPeAccounts`.
3. `chainpe login` signs in with the payout key and saves an ingest key.
4. The dashboard signs in with the same wallet. `chainpe-cloud` reads the plan from `ChainPeAccounts`, and returns only that provider's data.

## Built on

| Package | Used for |
|---|---|
| `@x402/core`, `@x402/evm`, `@x402/express`, `@x402/fetch` (2.30.x) | The x402 protocol |
| `@circle-fin/x402-batching` (4.0.x) | Circle's Facilitator and Gateway clients |
| `viem` | Arc reads, writes and signatures |
