---
title: Security and limits
description: What ChainPe guarantees, what it doesn't, and what has been reviewed.
---

## Guarantees

- **Paid before served.** Your API is never called for an `exact` payment that is pending or failed.
- **ChainPe holds no funds.** Buyers pay the seller's wallet or Gateway balance directly.
- **`chainpe-cloud` holds no private keys.**
- **Spending limits come before signing.** A price above `--max`, `maxPerCall` or the MCP wallet's limits is refused before anything is signed.
- **Revenue is verified.** The dashboard only counts payments matched to a USDC transfer on Arc or to Circle's Gateway record.

## Limits

- **Gateway is served on acceptance.** Circle locks the buyer's funds and the batch lands a few minutes later. If a batch ever failed, the seller would have served for free. The dashboard marks it as failed.
- **No refunds yet.** If your API fails after a payment, the buyer is still charged. The proxy counts these cases.
- **Anyone can rate an agent** on ERC-8004. The dashboard shows ratings from real payers first.
- **Testnet only.** Nothing has run on Arc mainnet yet, so `chainpe start` refuses it without `--allow-mainnet`. The MCP wallet needs `ALLOW_MAINNET=true`.
- **Not in Circle's marketplace yet.** The listing is prepared. Once submitted, Circle reviews it by hand.
- **Telemetry is your choice.** The proxy is open source, so you can turn reports off with `--no-telemetry`. You then give up verified revenue in the dashboard.

## Your keys

- The payout wallet's key has to be on the machine running the proxy, because Circle requires the seller to sign each settlement. Use a wallet only for receiving payments, and move earnings out regularly.
- Keep keys in your host's secret settings or in `.env`. Never commit them.
- Treat the ingest key as a secret. It can only report payments.
- Use a separate, lightly funded wallet for any agent.

## Reviews

- [`ChainPeAccounts` review](https://github.com/SamyaDeb/ChainPe/blob/arc/docs/arc/reviews/chainpe-accounts-review.md): one Medium issue found and fixed before launch.
- [Dashboard review](https://github.com/SamyaDeb/ChainPe/blob/arc/docs/arc/reviews/dashboard-review.md).

Neither is a professional third-party audit.
