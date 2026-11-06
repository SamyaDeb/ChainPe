# Try ChainPe: pay an API on Arc in 5 minutes

You will pay **$0.01 in test USDC** to a live weather API, from your own wallet.
No real money is involved. Everything runs on Arc testnet.

## What you need

- Node.js 22.18 or newer (`node -v`)
- Git
- 5 minutes

## 1. Get the code

```sh
git clone https://github.com/SamyaDeb/ChainPe.git
cd ChainPe
git checkout arc
npm install
npm run build:cli
```

On Linux, if the build fails with a missing `rollup` or `esbuild` package, run this once and build again:

```sh
npm install --no-save @esbuild/linux-x64@0.27.7 @rollup/rollup-linux-x64-gnu@4.62.0
```

## 2. Make a fresh test wallet

Use a new wallet just for this. Never use a wallet that holds real money.

```sh
cd packages/chainpe
node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log('address:',privateKeyToAccount(k).address);console.log('key:    ',k)"
cd ../..
```

Keep the key private. Copy the address.

## 3. Get free test USDC

1. Open https://faucet.circle.com
2. Pick **Arc Testnet** and **USDC**.
3. Paste your address and request funds.

On Arc, gas is also paid in USDC, so this one faucet drop covers everything.

## 4. Pay the API

```sh
export CHAINPE_PRIVATE_KEY=<your test key>
node packages/chainpe/dist/cli.js fetch \
  "https://chainpe-arc-demo-production.up.railway.app/forecast?city=Mumbai" \
  --network arc-testnet --rail exact --max 0.02
```

What happens:

1. The API answers `402 Payment Required` with its price ($0.01).
2. The CLI signs a USDC payment from your wallet. It refuses to pay more than `--max`.
3. Circle settles the payment on Arc. Then the API sends the forecast.

You will see the forecast JSON and a link to your transaction on the Arc explorer.

## 5. Send it back

Send Akash the transaction link the CLI printed. That proves a second, independent wallet paid the demo.

## If something goes wrong

| You see | Do this |
|---|---|
| `insufficient` or balance error | The faucet drop has not arrived yet. Wait a minute and retry. |
| `Refused: price is above --max` | The price changed. Raise `--max` a little. |
| Connection error | The demo seller may be restarting. Try again in a minute. |
