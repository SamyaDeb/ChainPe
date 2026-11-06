---
title: Sell your API
description: Put a USDC price on an HTTP API, test it locally, and go live on Arc testnet.
---

By the end, agents can pay your API per call and you can see the revenue in your dashboard.

**You need:** the CLI [built from source](/docs/getting-started/quickstart#1-build-the-cli), an API running somewhere, and a wallet just for receiving payments. Get test USDC from https://faucet.circle.com, because registering costs a little gas.

## 1. Configure

```bash
chainpe init
```

This asks for your API URL, public URL, description, tags, price, paths, network, wallet and port. It writes `~/.chainpe/config.json`:

```json
{
  "serviceName": "Weather API",
  "serviceDescription": "Current weather and 5-day forecasts for any city, as clean JSON your agent can parse. No API key or signup: pay per call in USDC on Arc.",
  "tags": ["weather", "forecast"],
  "targetUrl": "http://localhost:3000",
  "pricePerRequest": "0.01",
  "paymentToken": "USDC",
  "walletAddress": "0xYourPayoutWallet",
  "proxyPort": 4402,
  "network": "arc-testnet",
  "routes": [
    { "path": "GET /weather", "pricePerRequest": "0.001", "paymentToken": "USDC",
      "description": "Current weather for a city",
      "query": { "city": "City name, for example London" } },
    { "path": "GET /forecast", "pricePerRequest": "0.01", "paymentToken": "USDC",
      "description": "5-day forecast for a city",
      "query": { "city": "City name, for example London" } }
  ]
}
```

You can edit this file directly. The fields are in [configuration](/docs/reference/configuration).

**How pricing works.** `routes` set prices for specific paths. Everything else, including paths you didn't list, costs `pricePerRequest`, so **set the default deliberately**. A route under $0.01 is offered on Gateway only. [Route matching](/docs/developers/proxy#routes-and-pricing) has the details.

## 2. Start the proxy

The payout wallet's key must be available, because Circle requires the seller to sign each settlement. The CLI checks that it matches `walletAddress` and refuses to start if not.

```bash
export CHAINPE_SELLER_PRIVATE_KEY=<the payout wallet's key>
chainpe start --network arc-testnet
```

```text
    Rails:       exact, gateway
    Facilitator: circle-keyless
    Telemetry:   off
```

`circle-keyless` is Circle's free trial, with an allowance per payout wallet. When it's used up, payments fail with `registration_required`. Set `CIRCLE_API_KEY` to continue.

## 3. Test it locally

No wallet or funds are needed to see the gate working:

```bash
# Not charged: answered by the proxy itself
curl localhost:4402/health
# {"status":"ok","service":"Weather API","uptime":1.05}

# Unpaid: 402, and your API is not called
curl -i localhost:4402/forecast

# Read the payment options
curl -si localhost:4402/forecast | grep -i '^payment-required:' \
  | cut -d' ' -f2 | tr -d '\r' | base64 -d
```

Check your API's logs: it should have received nothing. Now pay it from a second, funded wallet:

```bash
CHAINPE_PRIVATE_KEY=<a funded buyer key> chainpe fetch "http://localhost:4402/forecast?city=Tokyo" \
  --network arc-testnet --rail exact --max 0.02
```

Your API gets a normal request. The proxy strips the payment headers, so you don't need to change anything.

## 4. Go public

Agents need to reach the proxy, so host it with a public HTTPS address. Any host that runs Node or Docker works. [This Dockerfile](https://github.com/SamyaDeb/ChainPe/blob/arc/examples/arc-demo/Dockerfile) runs the live demo, with the backend on a private port and the proxy on the public one.

**Keep your API private.** Agents must only be able to reach the proxy. If your API is also public, anyone can skip the payment by calling it directly.

| Set on your host | Value |
|---|---|
| `CHAINPE_SELLER_PRIVATE_KEY` | The payout key, in the host's secret settings |
| `CHAINPE_CONFIG` | The path to your config file, if it isn't in `~/.chainpe` |
| `CHAINPE_CLOUD_URL`, `CHAINPE_INGEST_KEY` | From step 5, to report payments |

Then set `publicUrl` in the config to that HTTPS address, and start with `chainpe start --port "$PORT"`. Behind a load balancer, `publicUrl` is what makes `resource.url` correct in your 402s.

## 5. Register and connect

Run these once, with `publicUrl` set and the seller key exported. The first two send transactions, paid in USDC.

```bash
chainpe identity   # finds or mints your ERC-8004 identity
chainpe register   # creates your provider account and lists the service
chainpe login      # connects this machine to the dashboard, and saves an ingest key
```

`chainpe register` is safe to repeat. It sends nothing if your listing is already up to date, and it updates the listing if your config changed.

**Restart the proxy now.** It reads the config once at startup, so it needs a restart to pick up your agent id and ingest key. Your payments then appear in the [dashboard](https://chainpe.vercel.app/dashboard).

## 6. Check everything

```bash
chainpe doctor --pay   # needs a funded buyer key in CHAINPE_PRIVATE_KEY
```

This runs 12 checks and generates `/openapi.json` and `/.well-known/x402`. `--pay` makes one real paid call per route to learn your response fields, which Circle's marketplace needs. To avoid spending, pass an example with `--sample <file>` instead. See [`chainpe doctor`](/docs/developers/doctor).

Run it where the proxy can read the files it writes. On a host, that means inside the container.

When every required check passes, it prints the values for [Circle's listing form](https://forms.gle/7YFzvdmMcn1JH5tF6).

## 7. Collect your earnings

`exact` payments are already in your payout wallet. Gateway payments build up in your Gateway balance:

```bash
chainpe balance
#   Gateway available: 0.011000 USDC
#   Gateway total:     0.011000 USDC
#   Pending batch:     0.001000 USDC
#   On-chain USDC:     1.250000 USDC

chainpe withdraw --all
```

Each withdrawal has a fee, so don't withdraw tiny amounts. [The numbers are here](/docs/concepts/payment-rails#withdrawals).

## Production checklist

- [ ] Your API can't be reached except through the proxy
- [ ] The payout wallet is used for nothing else, and you sweep it regularly
- [ ] The key is in your host's secret settings, not in a file or an image
- [ ] `/health` on the proxy is your host's health check. It isn't charged
- [ ] Your API returns 2xx only for real results, because buyers pay even when it fails
- [ ] `adminKey` is set if you read `/chainpe-admin` remotely
- [ ] `chainpe doctor` passes
