# Arc swap agents

Three paid swap agents on Arc Testnet. Claude finds them through the ChainPe wallet MCP, compares their ERC-8004
reputation, pays the best one over x402, and the agent swaps through Circle App Kit.

| Agent | Fee | Behaviour |
|---|---|---|
| Harbor Swap | 0.05 USDC | 1000 bps slippage, 3 attempts, refund on failure |
| Bolt Swap | 0.03 USDC | 300 bps slippage, 1 attempt, refund on failure |
| Drift Swap | 0.01 USDC | Lowest fee, but keeps 5% of the swap. It is the deliberate bad actor |

`POST /swap/0.5` and `POST /swap/1` cost the swap size plus the fee. The payment funds the swap, and the output goes to
`recipient`. `POST /quote` costs 0.01 USDC. Payment is `exact` only, because the agent needs the USDC in its wallet
before it swaps and a Gateway batch lands later.

A failed swap refunds the size to `recipient` and keeps the fee. The proxy does not tell the backend who paid, so a
paid call with an invalid `recipient` cannot be refunded.

## Run it

Needs `CHAINPE_PRIVATE_KEY` in the repo root `.env`, a funded testnet wallet, and `npm run build` at the repo root.

```sh
npm install
npm run setup            # makes four wallets, keys in .env here, tops them up from the buyer
npm run up               # tunnels, on-chain listings, backends and proxies. Leave it running
npm run review           # paid swaps from a separate wallet, scored and posted to ERC-8004
```

`npm run up` publishes each agent's tunnel URL on-chain and exposes its paying proxy to the internet. Backends listen
on 127.0.0.1 only. For payments and swaps without any of that, use `node up.mjs --local` and `node local-check.mjs`.

## The demo

```sh
./demo.sh
```

This gives Claude only the wallet tools, in an empty folder. Run from inside the repo, Claude reads this code and learns
what Drift does, so reputation is no longer what decides.

> Swap 1 USDC to EURC on Arc using the best-rated swap agent. Compare them first and tell me why you picked it.

## How scores are set

`scoreFor` in `agents.mjs` compares the EURC that arrives on-chain with a quote taken just before the swap: 100 within
1% of the quote, minus 10 points per further 1% short. A refund scores 40, and a loss scores 0. Measured on 2026-11-06,
Harbor scored 100 (0.623557 of 0.623557 EURC) and Drift 60 (0.592246 of 0.623413 EURC).

All ratings come from one reviewer wallet, so say on camera that you seeded them.

Arc Testnet pools are thin and their prices are not market prices: 0.5 USDC returned about 0.62 EURC.
