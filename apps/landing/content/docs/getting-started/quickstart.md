---
title: Pay an API in 5 minutes
description: Pay $0.01 in test USDC to a live weather API from your own wallet.
---

You'll pay **$0.01 in test USDC** to a live weather API. No real money is involved, because everything runs on Arc testnet.

**You need:** Node.js 22.18 or newer.

## 1. Install the CLI

```bash
mkdir chainpe-try && cd chainpe-try
npm init -y
npm install @chainpearc/cli
```

This keeps everything in one folder, and you run it with `npx chainpe`. To use plain `chainpe` everywhere, run `npm install -g @chainpearc/cli` instead, and drop `npx` from the commands below.

## 2. Make a test wallet

Use a new wallet just for this. Never use one that holds real money.

```bash
node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log('address:',privateKeyToAccount(k).address);console.log('key:    ',k)"
```

```bash
export CHAINPE_PRIVATE_KEY=<the key it printed>
```

> The CLI also reads a `.env` file from the current folder. A key already exported in your shell takes priority over it.

## 3. Get free test USDC

Open https://faucet.circle.com, pick **Arc Testnet** and **USDC**, paste your address and request funds. Gas on Arc is paid in USDC, so this one drop covers everything.

## 4. Pay

```bash
npx chainpe fetch "https://chainpe-arc-demo-production.up.railway.app/forecast?city=Mumbai" \
  --network arc-testnet --rail exact --max 0.02
```

Three things happen:

1. The API answers `402` with a price of $0.01. That's under your `--max` of $0.02, so the CLI carries on. A higher price would stop here, before anything is signed.
2. The CLI signs a USDC transfer of exactly $0.01 to the seller.
3. Circle settles it on Arc, and only then does the API run.

You'll see the status, a transaction link and the forecast JSON:

```text
  ✓ 200
    Tx:       0x11027eae…
    Explorer: https://explorer.testnet.arc.io/tx/0x11027eae…

{"success":true,"data":{ ... }}
```

Open the explorer link to see your USDC transfer on-chain.

## 5. Try a nanopayment

`/weather` costs $0.001. That's below the $0.01 floor for a normal payment, so it only takes Circle Gateway, which pays from a prepaid balance with no gas per call.

```bash
npx chainpe deposit 1 --network arc-testnet

npx chainpe fetch "https://chainpe-arc-demo-production.up.railway.app/weather?city=Mumbai" \
  --network arc-testnet --rail gateway --max 0.01
```

This time you get a Gateway payment id instead of a transaction hash, because Circle settles these in batches. [Compare the two rails](/docs/concepts/payment-rails).

## If it failed

| You see | Meaning | Fix |
|---|---|---|
| `insufficient_funds` | The wallet doesn't hold enough USDC | The faucet drop may not have landed. Wait a minute and retry |
| `insufficient_balance` | Your Gateway deposit is too low | Run `npx chainpe deposit 1 --network arc-testnet` |
| `rejected by spendControls` | The price is above `--max` | Raise `--max` if you accept the price. Nothing was signed |
| `filtered out by policies` | The route has no option on your `--rail` | `/weather` is Gateway only, so use `--rail gateway` |

Everything else is in the [error reference](/docs/reference/errors).

## Next

- [Sell your own API](/docs/getting-started/sell-your-api)
- [Pay from code with the SDK](/docs/developers/sdk)
