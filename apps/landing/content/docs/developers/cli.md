---
title: CLI and proxy
description: Every chainpe command, and how the proxy behaves.
---

`@chainpearc/cli` provides the `chainpe` command. It needs Node.js 22.18 or newer.

```bash
npm install -g @chainpearc/cli
```

## Selling

| Command | What it does |
|---|---|
| `chainpe init` | Sets up your API URL, price and payout wallet |
| `chainpe start` | Starts the payment proxy |
| `chainpe login` / `logout` | Connects this machine to the dashboard, or disconnects it |
| `chainpe identity` | Finds or mints your ERC-8004 identity |
| `chainpe register` / `deregister` | Adds or deactivates your service on `ChainPeAccounts` |
| `chainpe list` | Lists registered services |
| `chainpe plan` / `upgrade` | Shows your plan, or pays for Pro in USDC |
| `chainpe doctor` | Checks your service is ready for agents and Circle's marketplace |
| `chainpe status` | Shows your configuration |
| `chainpe balance` | Shows your Gateway and on-chain USDC balances |
| `chainpe withdraw [amount]` | Withdraws your earnings from Gateway to your payout wallet |

## Buying

| Command | What it does |
|---|---|
| `chainpe discover [query]` | Finds paid services through Circle's Discovery API and `ChainPeAccounts` |
| `chainpe fetch <url>` | Calls a URL, paying any x402 price in USDC |
| `chainpe deposit <amount>` | Deposits USDC into Circle Gateway |

Run `chainpe <command> --help` for all the options.

## `chainpe start` options

| Option | What it does |
|---|---|
| `-n, --network <network>` | `arc-testnet` or `arc` |
| `-p, --port <port>` | Overrides the proxy port |
| `--rails <rails>` | Rails to accept: `exact`, `gateway` or both |
| `--no-telemetry` | Sends nothing to the dashboard |
| `--allow-mainnet` | Starts on Arc mainnet, which takes real USDC and isn't tested yet |

## `chainpe fetch` options

| Option | What it does |
|---|---|
| `--max <usdc>` | The most to pay for one call, refused before signing. The default is 1 |
| `--rail <rail>` | `exact`, `gateway` or `auto`. `auto` uses Gateway if the deposit covers the price |
| `-X`, `-H`, `-d` | Method, header and body, as in curl |
| `--raw` | Prints only the response body |

## `chainpe doctor` options

| Option | What it does |
|---|---|
| `--pay` | Makes one real paid call per route with `CHAINPE_PRIVATE_KEY` |
| `--sample <file>` | Uses example responses from a JSON file, by route |
| `--url <url>` | Checks a proxy at this URL instead of `publicUrl` |
| `--regenerate` | Overwrites the generated documents |
| `--json` | Prints the report as JSON |

Doctor exits with an error if a required check fails or can't get an answer. It needs no key unless you use `--pay`.

## More

- [How the proxy behaves](/docs/developers/proxy): routes, reserved paths and what your API receives
- [`chainpe doctor`](/docs/developers/doctor): all 12 checks and how to fix each one
- [Errors](/docs/reference/errors#cli-messages): every CLI message
