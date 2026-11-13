# Deploying the ChainPe facilitator (public URL)

The facilitator is a stateless HTTP service. Any integrator points their provider
proxy at it via `CHAINPE_FACILITATOR_URL`. It is **non-custodial** — its key only
pays settlement gas and relays the payer's signed authorization.

## Prerequisites

- A dedicated EOA as the **gas key** (`FACILITATOR_PRIVATE_KEY`). Do **not** reuse
  a key that holds user funds.
- Fund it with **AVAX** for gas (available on major exchanges; Fuji testnet faucet: <https://faucet.avax.network>). Each
  settlement costs a small amount of AVAX; top up as needed (watch `/status`).

## Deploy to Railway

`railway.json` (NIXPACKS build + `/health` healthcheck) and a `Dockerfile` are
included. Railway injects `PORT` automatically.

### Option A — Railway CLI

```bash
cd services/chainpe-facilitator
railway init                       # create/link a project
railway variables \
  --set FACILITATOR_PRIVATE_KEY=0x... \
  --set NETWORK=avalanche
railway up                         # build + deploy
railway domain                     # mint a public https URL
```

### Option B — Dashboard

1. New Project → Deploy from GitHub repo → set **Root Directory** to
   `services/chainpe-facilitator`.
2. Variables: `FACILITATOR_PRIVATE_KEY`, `NETWORK=avalanche` (optionally `RPC_URL`).
3. Networking → **Generate Domain**.

## Verify

```bash
curl https://<your-domain>/health      # { status: "ok", custodial: false, ... }
curl https://<your-domain>/supported   # exact / avalanche
curl https://<your-domain>/status      # gasBalanceAvax + lowGas flag
```

Then point a provider at it:

```bash
export CHAINPE_FACILITATOR_URL=https://<your-domain>
chainpe start          # the proxy now settles through the hosted facilitator
```

A provider settling a real 402 through the URL closes the Phase 4 facilitator
acceptance. Record the URL in `docs/DEPLOYMENTS.md` and the root README.

## Operating notes

- **Liveness:** `/health` is cheap (no RPC); Railway healthchecks hit it.
- **Gas monitoring:** poll `/status` (reads the chain) — alert when `lowGas` is true.
- **Networks:** one instance serves one network (`NETWORK`). Run a second instance
  for mainnet with its own funded key.
- **Security:** keep the key only in the platform's secret store; never commit it.
