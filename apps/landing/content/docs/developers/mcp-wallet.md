---
title: MCP wallet
description: Give Claude a USDC wallet on Arc, with spending limits.
---

`@chainpearc/wallet-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server. Claude can search for x402 services, pay for them per call and return the results in your chat.

## Set up

1. Make a new wallet just for this. Never use one that holds real money.
2. Get free test USDC at https://faucet.circle.com (pick Arc Testnet). On Arc, this USDC also pays for gas.
3. Add the server to Claude Desktop's config, or to any MCP client:

```json
{
  "mcpServers": {
    "chainpe-wallet": {
      "command": "npx",
      "args": ["-y", "@chainpearc/wallet-mcp"],
      "env": {
        "CHAINPE_PRIVATE_KEY": "0x...",
        "MAX_PER_CALL": "0.10",
        "MAX_PER_DAY": "5.00"
      }
    }
  }
}
```

Then ask Claude: *"Find a weather API under $0.01 and get the forecast for Mumbai."*

## Tools

| Tool | What it does |
|---|---|
| `search_bazaar` | Finds services through Circle's Discovery API and ChainPe's on-chain listings. Needs no wallet |
| `x402_fetch` | Calls a URL, paying a 402 within your limits |
| `pay` | The same, on a rail you choose: `exact` or `gateway` |
| `check_balance` | Shows the address, USDC and Circle Gateway deposit |
| `deposit_gateway` | Moves USDC into Circle Gateway, for payments with no gas |
| `transfer_usdc` | Sends USDC to an address |
| `spending_report` | Shows what was spent against your limits |
| `request_funding` | Asks for USDC, with a payment link and the testnet faucet |
| `give_feedback` | Rates a provider 0 to 100 on-chain |

## Limits

- `MAX_PER_CALL` and `MAX_PER_DAY` are checked **before** a payment is signed. They also apply to `transfer_usdc`.
- The daily total is kept in memory, so it starts again when the server restarts.
- Deposits are not counted as spending, because the funds stay yours, but one deposit can't be above `MAX_PER_DAY`.
- Ratings and deposits use a little gas in USDC. Claude only rates a provider when it chooses to or you ask.
- What a listing says about itself is unverified.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `CHAINPE_PRIVATE_KEY` | none | The wallet key. Without it, only `search_bazaar` and `spending_report` work |
| `NETWORK` | `arc-testnet` | `arc-testnet`, or `arc` with `ALLOW_MAINNET=true` |
| `MAX_PER_CALL` | `0.10` | Most USDC for one payment |
| `MAX_PER_DAY` | `20.00` | Most USDC per day |
| `RAILS` | `gateway,exact` | Payment rails, in order of preference |
| `CHAINPE_ACCOUNTS_ADDRESS` | the deployed contract | `ChainPeAccounts` |
| `ERC8004_REPUTATION_REGISTRY` | Arc's registry | Where ratings are read and written |
