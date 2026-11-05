# Spec 09 — Buyer side on Arc: SDK, AI tools, MCP wallet

**Goal:** agents built with ChainPe can find services through Circle's Discovery API, pay on Arc by
either rail, stay within budgets, and rate the service.

## SDK (`packages/chainpe-sdk`)

```ts
const cp = new ChainPe({ privateKey, network: 'arc-testnet', rails: ['gateway', 'exact'] })
await cp.discover({ query: 'weather', maxUsdPrice: 0.01 })   // Circle Discovery API
const res = await cp.fetch(url)                              // pays per 402, preference order = rails
await cp.giveFeedback(agentId, 90)                           // Arc ReputationRegistry
await cp.balance()                                           // { usdc, gateway }
await cp.depositGateway('1.00')                              // GatewayClient.deposit
```

- `fetch`: `@x402/fetch` `wrapFetchWithPaymentFromConfig` with `ExactEvmScheme(account)` on the network's CAIP-2, plus
  `CompositeEvmScheme` from `@circle-fin/x402-batching/client` so Gateway options are paid from the Gateway balance.
- `discover`: `GET https://api.circle.com/v2/x402/discovery/resources` with `query`, `category`, `network` (CAIP-2),
  `maxUsdPrice`, `supportsCircleGateway`; map to existing `DiscoveredService` type; fallback to `ChainPeAccounts.getServices`.
- `balance`: ERC-20 USDC (6 dec) + `GatewayClient.getBalances()`; no AVAX on Arc.
- Budgets: keep `maxPerCall` / `maxPerDay` guards before signing (existing logic).

## AI tools (`packages/chainpe-ai-tools`)

Pass `network` and `rails` through; tool descriptions mention USDC on Arc. No other change.

## MCP wallet (`packages/chainpe-wallet`, 9 tools)

| Tool | Arc behaviour |
|---|---|
| `search_bazaar` | Circle Discovery API (spec above) |
| `x402_fetch`, `pay` | both rails, budget guard |
| `check_balance` | USDC + Gateway balance; gas shown as USDC |
| `transfer_usdc` | ERC-20 `0x3600…0000` |
| `transfer_avax` | hidden when network is `arc*` |
| `give_feedback` | Arc ReputationRegistry |
| `spending_report` | unchanged, labels per network |
| `request_funding` | on `arc-testnet` returns `https://faucet.circle.com` instructions |

`manifest.json` description: "Pay for x402 APIs in USDC on Arc and Avalanche".

## Agent (`packages/chainpe-agent`)

Network option only; uses the SDK.

## Acceptance

- [ ] Claude Desktop with the MCP wallet on `arc-testnet`: "find a weather API under $0.01 and call it" → discovers, pays, returns data.
- [ ] Same with only a Gateway deposit (no wallet USDC except gas) → pays via Gateway.
- [ ] Budget: a call above `MAX_PER_CALL` is refused before signing.
