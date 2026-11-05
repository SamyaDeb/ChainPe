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

Two facilitators cannot share `exact` on one network, so a router dispatches by `extra.name`. Why, with
evidence: `03a-gateway-design.md`.

```ts
const facilitator = new RailRouter({ exact: settlementGuard, gateway: gatewayGuard })
new x402ResourceServer(facilitator).register(caip2, new ExactEvmScheme())
```

Route `accepts` lists exact, then Gateway, with the same `payTo` and price. Config:

```json
{ "rails": ["exact", "gateway"] }   // default: both
```

Prices below `$0.01`: only the Gateway option is listed, and `chainpe start` warns once. A route left with no
option stops `chainpe start`, as does Gateway being unreachable while the rail is on.

## New CLI commands

| Command | Does |
|---|---|
| `chainpe balance` | Seller Gateway available, total and pending (not yet batched), and on-chain USDC |
| `chainpe withdraw <amount> [--chain <name>]` | `GatewayClient.withdraw(amount, { chain })`; prints tx. A fee comes on top of the amount (0.0035 USDC seen on Arc testnet) |
| `chainpe deposit <amount>` | Buyer deposit into Gateway (`CHAINPE_PRIVATE_KEY`) |
| `chainpe fetch <url> --rail gateway\|exact\|auto` | `auto` uses Gateway if the deposit covers the price |

Both use the seller key locally. Telemetry heartbeat (spec 08) reports the Gateway balance every 5 min.

## Acceptance

- [x] Unpaid request → 402 with two `accepts` (exact on `eip155:5042002`, Gateway with `extra.name: "GatewayWalletBatched"`).
- [x] Buyer with only a Gateway deposit pays a `$0.001` route; backend called once.
- [x] `chainpe balance` increases after the batch lands.
- [ ] `chainpe withdraw` returns a tx on Arc testnet. Needs `available` to cover the amount plus the fee.
