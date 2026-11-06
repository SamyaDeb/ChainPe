---
title: Sell your API
description: Put a USDC price on an HTTP API and let agents pay per call.
---

ChainPe is a reverse proxy that sits in front of your API. Every request to the proxy needs a payment, and your API's code doesn't change.

Build the CLI first, as in the [quickstart](/docs/getting-started/quickstart), then add a shortcut:

```bash
alias chainpe="node $(pwd)/packages/chainpe/dist/cli.js"
```

## 1. Set a price

```bash
chainpe init
```

This asks for your API URL, price and payout wallet, and saves them in `~/.chainpe/config.json`. You can price routes separately.

## 2. Start the proxy

```bash
export CHAINPE_SELLER_PRIVATE_KEY=<the payout wallet's key>
chainpe start --network arc-testnet
```

The proxy listens on port 4402 by default. An unpaid request now gets `402 Payment Required`.

## 3. Go public

Agents need to reach the proxy, so run it somewhere with a public HTTPS address. Any host that runs Node or Docker works, and the demo API uses [this Dockerfile](https://github.com/SamyaDeb/ChainPe/blob/arc/examples/arc-demo/Dockerfile).

Set that address as `publicUrl` in `~/.chainpe/config.json`, then run:

```bash
chainpe identity     # an ERC-8004 identity for your service
chainpe register     # your provider account on Arc
chainpe login        # connects this machine to the dashboard
chainpe doctor       # checks you are ready for agents and Circle's marketplace
```

Restart the proxy after `chainpe login`. Your payments then appear in the [dashboard](https://chainpe.vercel.app/dashboard). On a hosted proxy, set `CHAINPE_CLOUD_URL` and `CHAINPE_INGEST_KEY` from the values `chainpe login` saves.

## 4. Get listed

Circle's marketplace needs each route's response fields, so `chainpe doctor` needs a real answer from your API. Choose one:

- Run `chainpe doctor --pay` with a funded buyer key in `CHAINPE_PRIVATE_KEY`. This spends one payment per route.
- Pass an example response with `--sample <file>`.

Run it where the proxy can read the documents it writes, then restart the proxy.

When every required check passes, `chainpe doctor` prints the values for [Circle's listing form](https://forms.gle/7YFzvdmMcn1JH5tF6). Circle reviews listings by hand. Until yours is approved, agents can still pay you at your URL.

## 5. Collect your earnings

Normal x402 payments arrive in your payout wallet. Gateway payments build up in your Circle Gateway balance:

```bash
chainpe balance
chainpe withdraw --all
```

Each withdrawal has a fee. See [payment rails](/docs/concepts/payment-rails#withdrawals).

## Keep your key safe

- The payout wallet's key has to be on the machine running the proxy, because Circle requires the seller to sign each settlement.
- Use a wallet only for receiving payments, and move earnings out regularly.
- Keep the key in your host's secret settings. Never commit it or put it in a file that gets uploaded.
- `chainpe login` saves an ingest key in `~/.chainpe/config.json`. It only lets a proxy report payments, but treat it as a secret too.
