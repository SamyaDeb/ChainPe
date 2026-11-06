---
title: Introduction
description: Turn any API into a paid service for AI agents on Arc, in one command.
---

ChainPe puts a USDC price on any HTTP API. It's a reverse proxy: agents call the proxy, pay per request, and the proxy calls your API only after the payment settles. Your API's code doesn't change, and buyers don't need an account or an API key.

See it now, with no wallet or install:

```bash
curl -i "https://chainpe-arc-demo-production.up.railway.app/forecast?city=Mumbai"
```

```http
HTTP/2 402
payment-required: eyJ4NDAyVmVyc2lvbiI6Mi...
x-chainpe-agent-id: 897796

{"error":"Payment required"}
```

That `402` is the whole interface. The header says what to pay and how, and any client that can sign a USDC payment can answer it. [Here's the format](/docs/concepts/x402).

## Pick your path

| You want to | Start here | Time |
|---|---|---|
| Make your first payment | [Pay an API in 5 minutes](/docs/getting-started/quickstart) | 5 min |
| Charge for your API | [Sell your API](/docs/getting-started/sell-your-api) | 15 min |
| Pay from TypeScript | [SDK](/docs/developers/sdk) | 5 min |
| Give an LLM agent a budget | [AI tools](/docs/developers/ai-tools) or [MCP wallet](/docs/developers/mcp-wallet) | 10 min |
| Pay from another language | [Pay without the SDK](/docs/developers/pay-without-sdk) | 20 min |
| Understand a failure | [Errors](/docs/reference/errors) | |

## How the pieces fit

```text
 Buyer (agent)            Your machine                  Circle            Arc
 ─────────────            ────────────                  ──────            ───
 GET /forecast  ───────►  ChainPe proxy
                ◄───────  402 + price
 signs payment
 GET + signature ──────►  ChainPe proxy  ── settle ──►  Facilitator ───►  USDC moves
                                         ◄── done ───   or Gateway
                          forwards to your API
                ◄───────  200 + your response
```

ChainPe owns the proxy, client tools, accounts contract and dashboard. Circle owns settlement, and Arc holds the money and ratings. Details are in [architecture](/docs/architecture).

## Status

Read this before you build on it:

- **Testnet only.** Nothing has run on Arc mainnet, so `chainpe start` refuses it without `--allow-mainnet`.
- **Not in Circle's Agent Marketplace yet.** The listing is prepared, and Circle reviews each one by hand. Agents can still pay you at your URL, and `chainpe discover` finds you once you register.
- **No refunds.** If your API fails after a payment settles, the buyer is still charged.
