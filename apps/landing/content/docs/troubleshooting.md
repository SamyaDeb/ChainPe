---
title: Troubleshooting
description: Common problems and how to fix them.
---

## Paying

| You see | Do this |
|---|---|
| `insufficient` or a balance error | The faucet drop may not have arrived. Wait a minute and retry. Check with https://explorer.testnet.arc.io |
| `Refused: price is above --max` | The price is higher than your limit. Raise `--max` if you accept the price |
| A connection error on the demo API | The demo seller may be restarting. Try again in a minute |
| A transaction never appears | On Arc, `maxFeePerGas` below 20 gwei is dropped with no error. Raise it |
| `--rail gateway` fails on balance | Deposit first: `chainpe deposit 1 --network arc-testnet` |

## Selling

| You see | Do this |
|---|---|
| `chainpe start` refuses `arc` | Arc mainnet isn't tested. Use `--network arc-testnet`. To go ahead with real USDC, pass `--allow-mainnet` |
| A cheap route has no payment option | `exact` starts at $0.01, so a cheaper route needs the `gateway` rail |
| A paid call fails after settling | Your API returned an error or was unreachable. The buyer is still charged, and the proxy counts these cases |
| No payments in the dashboard | Run `chainpe login`, then restart the proxy. On a host, set `CHAINPE_CLOUD_URL` and `CHAINPE_INGEST_KEY` |
| `Withdrawal needs ... USDC available` | The fee is charged on top of the amount. Withdraw less, or use `chainpe withdraw --all` |
| Gateway balance looks low | Earnings become available once their batch settles, which takes a few minutes |

## `chainpe doctor`

| Result | Do this |
|---|---|
| `unknown` | It couldn't get an answer from the RPC or network, which doesn't mean the check failed. Run it again |
| Response fields are missing | Run `chainpe doctor --pay` with a funded buyer key, or pass `--sample <file>` |
| Documents don't match the live 402 | You changed a price or route. Run `chainpe doctor --regenerate`, then restart the proxy |
| The identity check fails | Run `chainpe identity`. The wallet must own the identity |
| The registration check fails | Run `chainpe register` |
| A catch-all route can't be documented | Add `routes` to your config |

## Dashboard

| You see | Do this |
|---|---|
| `not_registered` | This wallet has no provider account. Run `chainpe register`, using the same wallet |
| `plan_required` | That view needs Pro. Run `chainpe upgrade` |
| New registrations are refused | You've reached your plan's service limit. Deactivate one, or upgrade |

## Building from source

On Linux, if the build fails with a missing `rollup` or `esbuild` package, run this once and build again:

```bash
npm install --no-save @esbuild/linux-x64@0.27.7 @rollup/rollup-linux-x64-gnu@4.62.0
```

ChainPe needs Node.js 22.18 or newer.
