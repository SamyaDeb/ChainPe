# @chainpe/cli

[![npm](https://img.shields.io/npm/v/@chainpe/cli.svg)](https://www.npmjs.com/package/@chainpe/cli)

**Put a USDC price on any HTTP API, and let AI agents pay per call on Arc.**

ChainPe is a reverse proxy that sits in front of your API. An unpaid request gets `402 Payment Required` with a price (the x402 standard). When an agent pays, Circle settles the payment on Arc, and only then does ChainPe call your API. Your API's code doesn't change.

> **Use Arc testnet for now.** ChainPe has not been tested on Arc mainnet, so `chainpe start` refuses it unless you pass `--allow-mainnet`.

## Requirements

- Node.js 22.18 or newer
- A wallet to receive payments. Get free test USDC at https://faucet.circle.com. On Arc, gas is also paid in USDC.

## Install

```bash
npm install -g @chainpe/cli
```

## Sell your API

```bash
chainpe init                          # your API URL, price and payout wallet

export CHAINPE_SELLER_PRIVATE_KEY=<the payout wallet's key>
chainpe start --network arc-testnet   # the paying proxy, on port 4402 by default
```

Every request to the proxy now needs a payment.

## Go public

Agents need to reach the proxy, so run it somewhere with a public HTTPS address. Any host that runs Node or Docker works; [this Dockerfile](https://github.com/SamyaDeb/ChainPe/blob/arc/examples/arc-demo/Dockerfile) is what the demo API uses. Set that address as `publicUrl` in `~/.chainpe/config.json`, then:

```bash
chainpe identity     # an ERC-8004 identity for your service
chainpe register     # your provider account on Arc
chainpe login        # connects this machine to the dashboard, on Arc testnet
chainpe doctor       # checks you are ready for agents and Circle's Agent Marketplace
```

Restart the proxy after `chainpe login`. Your payments then appear at https://chainpe.vercel.app/dashboard. On a hosted proxy, set `CHAINPE_CLOUD_URL` and `CHAINPE_INGEST_KEY` from the values `chainpe login` saves.

Circle's marketplace needs each route's response fields, so `chainpe doctor` needs a real answer from your API. Run `chainpe doctor --pay` with a funded buyer key in `CHAINPE_PRIVATE_KEY`, which spends one payment per route, or pass an example response with `--sample <file>`. Run it where the proxy can read the documents it writes, then restart the proxy.

When every required check passes, `chainpe doctor` prints the values for [Circle's listing form](https://forms.gle/7YFzvdmMcn1JH5tF6). Circle reviews listings by hand. Until yours is approved, agents can still pay you at your URL.

## Keep your key safe

- The payout wallet's key has to be on the machine running the proxy, because Circle requires the seller to sign each settlement.
- Use a wallet only for receiving payments, and move earnings out with `chainpe withdraw`.
- Keep the key in your host's secret settings. Never commit it or put it in a file that gets uploaded.
- `chainpe login` saves an ingest key in `~/.chainpe/config.json`. It only lets a proxy report payments, but treat it as a secret too.

## Pay an API

```bash
export CHAINPE_PRIVATE_KEY=<a test wallet key>
chainpe fetch "https://chainpe-arc-demo-production.up.railway.app/forecast?city=Mumbai" \
  --network arc-testnet --rail exact --max 0.02
```

`--max` is the most you will pay for the call. To pay from a prepaid balance with no gas, run `chainpe deposit 1 --network arc-testnet` once, then use `--rail gateway`.

## Commands

| Command | What it does |
|---|---|
| `chainpe init` | Set up your API URL, price and payout wallet |
| `chainpe start` | Start the payment proxy |
| `chainpe login` / `logout` | Connect this machine to the ChainPe dashboard, or disconnect it |
| `chainpe identity` | Find or mint your ERC-8004 identity |
| `chainpe register` / `deregister` | Add or deactivate your service on `ChainPeAccounts` |
| `chainpe list` | List registered services |
| `chainpe plan` / `upgrade` | Show your plan, or pay for Pro in USDC |
| `chainpe doctor` | Check your service is ready for agents and Circle's marketplace |
| `chainpe status` | Show your configuration |
| `chainpe fetch <url>` | Call a URL, paying any x402 price in USDC |
| `chainpe deposit <amount>` | Deposit USDC into Circle Gateway, to pay as a buyer |
| `chainpe balance` | Show your Gateway and on-chain USDC balances |
| `chainpe withdraw [amount]` | Withdraw your earnings from Gateway to your payout wallet |

Run `chainpe <command> --help` for the options.

## How it works

1. An agent calls the proxy and gets `402 Payment Required` with the price.
2. The agent signs a USDC payment.
3. Circle settles the payment on Arc. There are two options: a normal x402 payment for each call, or Circle Gateway, where small payments are batched from a prepaid balance.
4. The proxy calls your API and returns the answer. A payment that is pending or failed never reaches your API.

## Limits

- Only HTTP is proxied. WebSocket upgrades are not, because they would skip the payment check.
- There are no refunds yet. If your API fails after a payment, the buyer is still charged.

## Links

- [Source and full docs](https://github.com/SamyaDeb/ChainPe)
- [Provider dashboard](https://chainpe.vercel.app/dashboard)

## License

MIT
