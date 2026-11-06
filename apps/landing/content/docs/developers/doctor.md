---
title: chainpe doctor
description: The 12 checks, the files it generates, and how to fix each failure.
---

`chainpe doctor` checks your running service the way a buyer or Circle's reviewers would, and generates your discovery documents. Its checks only read. It spends money only if you pass `--pay`.

```bash
chainpe doctor                         # checks publicUrl from your config
chainpe doctor --url http://localhost:4402
```

It needs no key, unless you use `--pay`.

## The checks

| # | Check | Required | If it fails |
|---|---|---|---|
| 1 | Endpoint reachable over HTTPS | Yes | Start the proxy, or check your URL. Plain HTTP or a local address only warns |
| 2 | Unpaid request returns a decodable 402 | Yes | Something in front of the proxy is changing responses, or you're not reaching the proxy |
| 3 | Every `accepts` entry has network, `payTo` and price | Yes | Check the route's price in your config |
| 4 | Arc option present | Yes | The proxy is on a different network from `--network` |
| 5 | Gateway option present | Warns | Enable the `gateway` rail if you want nanopayments |
| 6 | `/.well-known/x402` matches the live 402 | Yes | You changed a price or route. Run `chainpe doctor --regenerate` |
| 7 | `/openapi.json` documents every paid route | Yes | Add `routes`, and use `--pay` or `--sample` for response fields |
| 8 | Description has at least 160 characters | Warns | Say what a buyer gets, in their words |
| 9 | ERC-8004 agent id set and owned by you | Yes | Run `chainpe identity` |
| 10 | Registered in `ChainPeAccounts` and matching | Yes | Run `chainpe register` |
| 11 | Test payment settles and your API answers 2xx | With `--pay` | Your API or the buyer wallet has the problem. The detail says which route |
| 12 | Visible in Circle's Discovery API | Info | Listing is manual, so submit the form |

Each check ends as one of:

| Status | Meaning |
|---|---|
| `pass` | Good |
| `fail` | Needs fixing. Doctor exits with code 1 if it's required |
| `warn` | Worth fixing, but not blocking |
| `unknown` | It couldn't get an answer from the RPC or network. **Not a failure, and not a pass.** Run it again. Doctor also exits with code 1 if it's required |
| `skip` | Didn't run. Check 11 skips without `--pay` |
| `info` | For your information |

## Options

| Option | What it does |
|---|---|
| `--url <url>` | Checks this address instead of `publicUrl` |
| `--pay` | Makes one real paid call per route, using `CHAINPE_PRIVATE_KEY` |
| `--sample <file>` | Reads example responses from a file, instead of paying |
| `--regenerate` | Overwrites the generated documents |
| `--json` | Prints the report as JSON |
| `-n, --network <network>` | `arc-testnet` or `arc` |

## Generated files

Doctor writes these next to your config, named after it. So `config.json` produces:

| File | Served at | Holds |
|---|---|---|
| `config.openapi.json` | `/openapi.json` | OpenAPI 3.1, with response fields |
| `config.x402.json` | `/.well-known/x402` | Prices, networks and rails |
| `config.discovery.json` | Not served | One listing per route, for Circle |
| `config.samples.json` | Not served | The response samples it used |
| `config.doctor.json` | Not served | The last report, sent with heartbeats |

The proxy must be able to read them, so **run doctor where the proxy runs**. Doctor writes them only if they're missing, so a hand edit stays until you pass `--regenerate`. `--sample` and `--pay` also overwrite them.

## Response fields

Circle's marketplace wants real field names, not just `{ "type": "object" }`. Doctor learns them from one real response per route. There are two ways to give it one.

**Pay for it.** One payment per route, from a funded buyer:

```bash
CHAINPE_PRIVATE_KEY=<funded buyer key> chainpe doctor --pay
```

**Or pass an example.** No money needed, with the file keyed by route:

```json
{
  "GET /weather": {
    "success": true,
    "data": { "location": { "city": "London", "country": "GB" } }
  }
}
```

```bash
chainpe doctor --sample samples.json
```

Keep each example small, under about 1.5 KB. Common indexers drop larger samples.

Add `query` to a route in your config to document its parameters:

```json
{ "path": "GET /weather", "pricePerRequest": "0.001", "paymentToken": "USDC",
  "description": "Current weather for a city",
  "query": { "city": "City name, for example London" } }
```

## In CI

`--json` prints a stable report, and the exit code tells you the result. `allGreen` is true only if everything that ran passed.

```bash
chainpe doctor --url "$STAGING_URL" --json > doctor.json
jq '.checks[] | select(.status=="fail") | {id, name, detail}' doctor.json
```

```json
{
  "version": 1,
  "generatedAt": "2026-11-06T09:44:09.120Z",
  "network": "arc-testnet",
  "endpoint": "https://api.example.com",
  "service": "Weather API",
  "ok": false,
  "allGreen": false,
  "score": { "passed": 4, "total": 10 },
  "checks": [
    { "id": 9, "name": "ERC-8004 agentId set and owned by the provider", "status": "fail",
      "required": true, "detail": "No agentId in the config. Run `chainpe identity`." }
  ]
}
```

## Getting listed

When every required check passes, doctor prints the values for [Circle's listing form](https://forms.gle/7YFzvdmMcn1JH5tF6): your endpoint, payout wallet, description and OpenAPI URL. Circle reviews listings by hand. Until yours is approved, check 12 stays `info`, and agents can still pay you at your URL.
