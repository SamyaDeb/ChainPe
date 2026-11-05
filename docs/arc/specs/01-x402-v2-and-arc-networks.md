# Spec 01 — Arc networks + x402 v1 → v2

**Goal:** every package understands `arc` and `arc-testnet`, and payments use x402 v2.
Avalanche (`avalanche`, `fuji`) keeps working.

## Why

`x402@1.2.0` (latest v1) has a fixed network enum: abstract, base, avalanche, iotex, solana, sei,
polygon, peaq, story, educhain, skale — **no Arc**. `@x402/evm@2.30.0` ships Arc defaults:
`eip155:5042` and `eip155:5042002`, asset `0x3600…0000`, EIP-712 name `USDC`, version `2`.

## 1. Network model

Add to every network type (`ChainPeNetwork`, `PaymentNetwork`):

```ts
export type ChainPeNetwork = 'fuji' | 'avalanche' | 'arc-testnet' | 'arc'
```

| ChainPe name | chainId | CAIP-2 | RPC (env override) | Explorer | USDC | Gas token |
|---|---|---|---|---|---|---|
| `fuji` | 43113 | `eip155:43113` | `FUJI_RPC_URL` | testnet.snowtrace.io | `0x5425890298aed601595a70AB815c96711a31Bc65` | AVAX |
| `avalanche` | 43114 | `eip155:43114` | `AVALANCHE_RPC_URL` | snowtrace.io | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | AVAX |
| `arc-testnet` | 5042002 | `eip155:5042002` | `ARC_TESTNET_RPC_URL` → `https://rpc.testnet.arc.io` | explorer.testnet.arc.io | `0x3600000000000000000000000000000000000000` | USDC |
| `arc` | 5042 | `eip155:5042` | `ARC_RPC_URL` → `https://rpc.mainnet.arc.io` | explorer.arc.io | `0x3600000000000000000000000000000000000000` | USDC |

viem chain objects (use `viem/chains` if it already exports Arc; otherwise define):

```ts
import { defineChain } from 'viem'
export const arcTestnet = defineChain({
  id: 5042002, name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, // native = 18, ERC-20 = 6
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://explorer.testnet.arc.io' } },
})
export const arc = defineChain({ ...arcTestnet, id: 5042, name: 'Arc',
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://explorer.arc.io' } } })
```

Add `gasToken: 'AVAX' | 'USDC'` and `caip2` to `NetworkInfo`. Replace every hard-coded "AVAX" gas
label/threshold with `gasToken`. On Arc, the "gas balance" is the USDC balance.

## 2. Files to change

| File | Change |
|---|---|
| `packages/chainpe/src/chains.ts` | add networks; `caip2`, `gasToken`; `fromX402Network` handles CAIP-2 + legacy names |
| `packages/chainpe/src/types.ts` | network union; config gains `rails`, `circleApiKey?`, `cloudUrl?`, `accountsAddress?` |
| `packages/chainpe-sdk/src/networks.ts` + `types.ts` | add networks; `DEFAULT_ACCOUNTS[arc*]`; Arc ERC-8004 defaults |
| `packages/chainpe-wallet/src/config.ts` + `types.ts` | `normalizeNetwork` accepts all four; mode label from network |
| `packages/chainpe-agent/src/config.ts` | same |
| `packages/chainpe-ai-tools/src/*` | network option passthrough |
| root `package.json` | `engines.node` → `>=22.18` for CLI work (Circle seller requirement) |

## 3. Dependency swap

| Remove (v1) | Add (v2) |
|---|---|
| `x402@^1.2.0` | `@x402/core@^2.30.0`, `@x402/evm@^2.30.0` |
| `x402-express@^1.2.0` | `@x402/express@^2.30.0` |
| `x402-fetch@^1.2.0` | `@x402/fetch@^2.30.0` |
| — | `@circle-fin/x402-batching@^4.0.0` (specs 02, 03) |

v2 differences to handle:

- Network ids are CAIP-2 (`eip155:<chainId>`); map legacy `avalanche` → `eip155:43114`, `avalanche-fuji` → `eip155:43113`.
- Headers: `X-PAYMENT` → `PAYMENT-SIGNATURE`; `X-PAYMENT-RESPONSE` → `PAYMENT-RESPONSE`; 402 body/header `PAYMENT-REQUIRED`.
- Server: `x402ResourceServer` + `.register('<caip2>', new ExactEvmScheme())` (`@x402/evm/exact/server`), passed to `paymentMiddleware(routes, server)` from `@x402/express`.
- Routes: `{ "GET /path": { accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:5042002', payTo }], description } }`.
- Client: `wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: 'eip155:*', client: new ExactEvmScheme(account) }] })` (`@x402/fetch`).

## 4. Migration order

1. CLI (`packages/chainpe`) on `arc-testnet` — highest value.
2. SDK, then wallet MCP, then ai-tools, then agent.
3. Delete v1 imports only after `fuji` passes on v2.

## Acceptance

- [ ] `npm run build && npm test` green.
- [ ] `chainpe status --network arc-testnet` prints chainId 5042002, CAIP-2, USDC gas.
- [ ] Unit test: `getNetwork('arc').caip2 === 'eip155:5042'`, `fromX402Network('eip155:5042002') === 'arc-testnet'`, `fromX402Network('avalanche') === 'avalanche'`.
- [ ] No string `AVAX` left in code paths that run for `arc*` (grep test).
- [ ] A `fuji` paid call still works on v2.
