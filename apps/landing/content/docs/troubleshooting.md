---
title: Troubleshooting
description: Diagnose problems by symptom, with commands that show what's actually happening.
---

For a specific error message, go to the [error reference](/docs/reference/errors). This page starts from what you're seeing.

## Three commands that answer most questions

```bash
# Is the proxy up?
curl https://your-proxy/health

# What does it charge, on which rails?
curl -si https://your-proxy/your-route | grep -i '^payment-required:' \
  | cut -d' ' -f2 | tr -d '\r' | base64 -d

# What does the proxy think happened? Run this on the same machine.
curl localhost:4402/chainpe-admin/stats
```

To see every request, start with `chainpe start --verbose`.

## As a buyer

### "I'm being charged the wrong amount, or a different price"

The 402 decides the price, per route. Read it with the command above. A path you didn't expect is charged the seller's default price, including typos.

### "My payment was refused"

Read `reason` in the 402 body, then look it up in [errors](/docs/reference/errors#payment-refused). Most often it's `insufficient_funds` (`exact`) or `insufficient_balance` (Gateway). Check with:

```bash
chainpe balance    # as a seller
```

```ts
await cp.balance() // { usdc, gateway }, as a buyer
```

Your wallet balance and your Gateway deposit are separate. Having USDC in your wallet doesn't help `--rail gateway`.

### "I paid and got an error"

Any status other than 402 after a payment means **you were charged**, and the API failed. There are no refunds. Your receipt is in `PAYMENT-RESPONSE`. Check the transaction on https://explorer.testnet.arc.io.

### "A request timed out. Did I pay?"

Maybe. Don't sign a new payment yet. Retry with the same signed payment, which can't charge you twice, or check the explorer for a transfer from your wallet. The SDK and CLI sign a new payment on each call, so check the explorer before calling again.

### "A transaction never appears"

On Arc, a `maxFeePerGas` below 20 gwei is dropped with no error. If you send your own transactions, raise it.

### "The CLI is using the wrong wallet"

It loads `.env` from the current folder. A variable set in your shell wins over that file. Check which address it prints:

```text
GET https://…  ·  wallet 0x5E78…b24E on arc-testnet
```

## As a seller

### "The proxy won't start"

The message says why, and [the error reference](/docs/reference/errors#chainpe-start) has each fix. The two most common are a seller key that doesn't match `walletAddress`, and a route under $0.01 with Gateway turned off.

### "Requests reach my API without payment"

The proxy can't let this happen on its own paths, so a caller is reaching your API directly. Make your API private, so only the proxy can call it. Also check that `publicUrl` is the proxy, not your API. `chainpe register` refuses the case where they're the same.

### "My API returns 402 on routes I wanted free"

Every path through the proxy is charged. The proxy has no free-route setting, apart from `/health` and the discovery documents. Host free routes on a separate address that doesn't go through the proxy.

### "Buyers are paying but my API failed"

The buyer is charged anyway. See how many:

```bash
curl localhost:4402/chainpe-admin/stats | jq .chargedButBackendFailed
```

Check that `targetUrl` is reachable from the proxy. A `502 Bad Gateway` to the buyer means it couldn't reach your API.

### "402 shows the wrong URL, like http://internal"

Set `publicUrl` in your config, and restart.

### "/openapi.json returns 404"

`{"error":"Not generated. Run \`chainpe doctor\`."}` means the files aren't there. Run `chainpe doctor --regenerate` where the proxy runs, using the same `CHAINPE_CONFIG`. `/.well-known/agent.json` also needs `publicUrl` set.

### "Payments suddenly fail with registration_required"

The Circle keyless trial for this payout wallet is used up. Testnet and mainnet are counted separately. Set `CIRCLE_API_KEY` and restart.

### "No payments in the dashboard"

Work through these in order:

1. Did you run `chainpe login`?
2. Did you restart the proxy afterwards? The startup log should show a `Telemetry:` URL, not `off`.
3. On a hosted proxy, are `CHAINPE_CLOUD_URL` and `CHAINPE_INGEST_KEY` set?
4. Is the dashboard signed in with the same wallet?
5. Payments can take a moment to verify. Gateway payments verify against Circle's record, and exact ones against the chain.

### "Revenue is lower than I expected"

The dashboard excludes unverified payments, and payments from your own wallets. Look at `notRevenue` in `/v1/me/summary`. See [verification](/docs/reference/cloud-api#verification).

### "Gateway balance looks low"

Earnings become available once their batch settles, which took a median of about 8 minutes in our sample. `chainpe balance` shows them as `Pending batch` until then.

### "chainpe doctor says unknown"

It couldn't reach the RPC or an API, which doesn't mean the check failed. The public RPC is rate-limited, so run it again, or set `ARC_TESTNET_RPC_URL`.

## Dashboard

| You see | Do this |
|---|---|
| `not_registered` | This wallet has no provider account. Run `chainpe register` with the same wallet |
| `plan_required` | That view needs Pro. Run `chainpe upgrade` |
| A wallet warning about the site | Check you're on https://chainpe.vercel.app |
| Signed out after a while | Sessions last 12 hours |

## Building from source

This only applies if you build the repo yourself. On Linux, if the build fails with a missing `rollup` or `esbuild` package, run this once and build again:

```bash
npm install --no-save @esbuild/linux-x64@0.27.7 @rollup/rollup-linux-x64-gnu@4.62.0
```

ChainPe needs Node.js 22.18 or newer. Check with `node -v`.

## Still stuck?

Open an issue at https://github.com/SamyaDeb/ChainPe/issues with the command you ran, the output, and your `chainpe status`. Never include a private key or ingest key.
