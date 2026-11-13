# ChainPe dashboard

The visible product: a Next.js marketplace UI for the ChainPe x402 economy on
Avalanche.

- **Marketplace** (`/`) — browse registered services + AI agents, ranked by
  on-chain **ERC-8004 reputation**, with price, tags, and search.
- **Service detail** (`/services/[id]`) — endpoint, price, pay-to, developer,
  linked agent, reputation, with Snowtrace links.
- **Register** (`/register`) — connect MetaMask / Core and publish a service to
  the on-chain registry (approve the USDC fee + `register`), all signed in the
  browser. No private key leaves the wallet.

## Data source

Reads the **deployed Fuji contracts directly via viem** out of the box, so it
works with zero backend. If you deploy the [indexer](../../services/chainpe-indexer)
and set `INDEXER_URL`, reads go through it (O(1)) instead.

## Run locally

```bash
cp .env.example .env        # optional; defaults target Fuji
npm install
npm run dev                 # http://localhost:3000
```

The marketplace will list the live Fuji services with real reputation. To
register, you need a browser wallet on Avalanche Fuji with a little USDC (the
registration fee) + AVAX (gas).

## Deploy

Standard Next.js app — deploy to Vercel (root directory `apps/dashboard`) or
Railway. Set `NEXT_PUBLIC_NETWORK` and, if using the indexer, `INDEXER_URL`.

## Verify

```bash
npm run typecheck
npm run build
```
