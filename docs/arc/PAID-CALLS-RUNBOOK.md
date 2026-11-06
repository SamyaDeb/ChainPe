# Phase 8 paid calls: run these yourself

This session could not reach the internet from your computer's shell, so the paid calls must run in your
own terminal (or a Claude Code session on your Mac). Paste the results into `docs/arc/PROOF.md`.

## 0. Setup (repo root, `.env` loaded)

```sh
set -a; source .env; set +a          # CHAINPE_PRIVATE_KEY = buyer, CHAINPE_NETWORK=arc-testnet
CLI="node packages/chainpe/dist/cli.js"
SELLER=https://chainpe-arc-demo-production.up.railway.app
```

## 1. Health check

```sh
CHAINPE_CONFIG=examples/arc-demo/config.json $CLI doctor
CHAINPE_CONFIG=examples/arc-demo/config.json $CLI doctor --pay
```

## 2. Top up Gateway if needed (the /weather route is Gateway only)

```sh
$CLI deposit 0.05
```

## 3. Ten paid calls

```sh
for c in London Paris Tokyo Delhi Lagos; do
  $CLI fetch "$SELLER/weather?city=$c" --rail gateway --max 0.02
done
for c in Mumbai Berlin Sydney Toronto Nairobi; do
  $CLI fetch "$SELLER/forecast?city=$c" --rail exact --max 0.02
done
```

Each line prints a Gateway transfer id (gateway) or a tx hash with an explorer link (exact).

## 4. Check they are verified in chainpe-cloud

Open the dashboard as the seller, or call `GET /v1/me/payments` with a seller session.
Exact payments usually verify in seconds. Gateway payments show `received` in under a minute and
`completed` once Circle's batch lands (about 3 minutes in Phase 5).

## 5. Add rows to PROOF.md

Same table style as the existing rows. Then add one line under the table:

`Totals (2026-11-06, Phase 8): 10 paid calls, 0.055 USDC (Gateway 0.005, exact 0.05), N of 10 verified.`

## 6. Second person

Send `docs/arc/TRY-IT.md` to a friend. Add their transaction link to PROOF.md when they send it.
