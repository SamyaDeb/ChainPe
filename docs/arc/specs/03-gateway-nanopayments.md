# Spec 03 — Circle Gateway nanopayments (second rail)

**Goal:** the same route accepts `exact` (buyer pays from wallet, Circle settles on-chain) **and**
Gateway batched payments (buyer pays from a Gateway deposit, gasless, down to $0.000001).

## SDK pieces (`@circle-fin/x402-batching@4.0.0`)

| Side | Import | Use |
|---|---|---|
| server | `BatchFacilitatorClient` (`/server`) | Gateway verify/settle; default URL `https://gateway-api.circle.com`, testnet `https://gateway-api-testnet.circle.com` |
| server | `GatewayEvmScheme` (`/server`) | register on `eip155:*` |
| server | `createGatewayMiddleware({ sellerAddress, facilitatorUrl?, networks? })` | standalone Gateway route (`.require('$0.001')`) |
| client | `GatewayClient({ chain: 'arcTestnet' \| 'arc', privateKey })` | `deposit('1.00')`, `pay(url)`, `getBalances()`, `withdraw('50', { chain? })` |
| client | `CompositeEvmScheme` | buyer picks the rail by `extra.name` (`GatewayWalletBatched` → Gateway) |

Supported (SDK README): mainnet includes **Arc**, Base, Arbitrum, Avalanche, Ethereum, Polygon…;
testnet includes **Arc Testnet**, Avalanche Fuji, Base Sepolia…

## Server wiring (proxy)

```ts
const server = new x402ResourceServer([
  circleFacilitator(cfg, sellerKey),                                   // spec 02 — exact
  new BatchFacilitatorClient({ url: gatewayUrl(cfg.network) }),        // Gateway
])
  .register(caip2, new ExactEvmScheme())
  .register('eip155:*', new GatewayEvmScheme())
await server.initialize()
```

Route `accepts` lists both options with the same `payTo` and price. Config:

```json
{ "rails": ["exact", "gateway"] }   // default both on arc*; ["exact"] on avalanche/fuji
```

Prices below `$0.01`: allow only the Gateway option (exact settlement fees make no sense there);
`chainpe start` warns when a route price < $0.01 has `exact` enabled.

## New CLI commands

| Command | Does |
|---|---|
| `chainpe balance` | `GatewayClient.getBalances()` for the seller: available + total (USDC) and on-chain USDC |
| `chainpe withdraw <amount> [--chain <name>]` | `GatewayClient.withdraw(amount, { chain })`; prints tx |

Both use the seller key locally. Telemetry heartbeat (spec 08) reports the Gateway balance every 5 min.

## Acceptance

- [ ] Unpaid request → 402 with two `accepts` (exact on `eip155:5042002`, Gateway with `extra.name: "GatewayWalletBatched"`).
- [ ] Buyer with only a Gateway deposit pays a `$0.001` route; backend called once.
- [ ] `chainpe balance` increases after the call; `chainpe withdraw 0.001` returns a tx on Arc testnet.
