---
title: Pay an API in 5 minutes
description: Pay $0.01 in test USDC to a live weather API from your own wallet.
---

You will pay **$0.01 in test USDC** to a live weather API. No real money is involved, because everything runs on Arc testnet.

You need Node.js 22.18 or newer, and Git.

## 1. Get the code

```bash
git clone https://github.com/SamyaDeb/ChainPe.git
cd ChainPe
git checkout arc
npm install
npm run build:cli
```

## 2. Make a test wallet

Use a new wallet just for this. Never use a wallet that holds real money.

```bash
cd packages/chainpe
node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log('address:',privateKeyToAccount(k).address);console.log('key:    ',k)"
cd ../..
```

Keep the key private, and copy the address.

## 3. Get free test USDC

1. Open https://faucet.circle.com
2. Pick **Arc Testnet** and **USDC**.
3. Paste your address and request funds.

On Arc, gas is also paid in USDC, so this one faucet drop covers everything.

## 4. Pay the API

```bash
export CHAINPE_PRIVATE_KEY=<your test key>
node packages/chainpe/dist/cli.js fetch \
  "https://chainpe-arc-demo-production.up.railway.app/forecast?city=Mumbai" \
  --network arc-testnet --rail exact --max 0.02
```

What happens:

1. The API answers `402 Payment Required` with its price of $0.01.
2. The CLI signs a USDC payment from your wallet. It refuses to pay more than `--max`.
3. Circle settles the payment on Arc, and the API sends the forecast.

You will see the forecast JSON and a link to your transaction on the Arc explorer.

## Next

- [Sell your own API](/docs/getting-started/sell-your-api)
- [Pay from code with the SDK](/docs/developers/sdk)
- [If something went wrong](/docs/troubleshooting)
