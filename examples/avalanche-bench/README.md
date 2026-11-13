# Avalanche benchmark

Live, read-only measurement of the Avalanche C-Chain properties ChainPe depends
on — average block time, deterministic finality, gas price — plus projected
per-operation fees. No funds, no keys.

```bash
node bench.mjs                                  # Avalanche C-Chain mainnet (default)
GAS_PRICE_GWEI=1 AVAX_USD=40 node bench.mjs     # tune the fee projection
CHAINPE_NETWORK=fuji node bench.mjs             # Fuji testnet RPC
```

Findings + the "why Avalanche" argument: [`docs/WHY-AVALANCHE.md`](../../docs/WHY-AVALANCHE.md).

> Fees are projected at a representative gas price (`GAS_PRICE_GWEI`, default 1)
> because testnet gas is ~0. Everything is recomputable: `fee = gasPrice × gas ×
> AVAX_USD`.
