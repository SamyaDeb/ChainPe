---
id: common-issues
title: Common Issues
sidebar_position: 2
---

# Common Issues

## 1. 402 not resolving — proxy misconfiguration

**Symptom:** `cp.fetch()` returns a `402` response instead of the expected data.

**Causes and fixes:**

- No facilitator configured: run `chainpe start --facilitator 0xYOUR_GAS_KEY` to use an in-process facilitator, or set `CHAINPE_FACILITATOR_URL` in your config.
- The facilitator is down: check `curl https://chainpe-facilitator-production.up.railway.app/health`. If 503, the gas key is low on AVAX.
- The proxy is on the wrong network: ensure `network` in `~/.chainpe/config.json` matches the client's `network` constructor option.
- The client and server are on different networks: the SDK error message will say `"server accepts [avalanche] but wallet is on fuji"`.

```bash
# Check facilitator health
curl https://chainpe-facilitator-production.up.railway.app/health

# Run with in-process facilitator
chainpe start --facilitator 0xYOUR_GAS_PRIVATE_KEY
```

---

## 2. Insufficient USDC allowance / balance

**Symptom:** Payment fails with an error about USDC balance or after the 402 is issued.

**Fixes:**
- Check your USDC balance: `chainpe status` (after `chainpe init`)
- Obtain USDC on Avalanche C-Chain from a CEX or bridge (e.g., [Stargate](https://stargate.finance)). For Fuji testnet development, use [faucet.circle.com](https://faucet.circle.com/) — select "Avalanche Fuji" — but the primary network is mainnet.
- For `register()`, ensure you have approved the registry for at least 0.1 USDC: the CLI does this automatically via `safeTransferFrom`, but you need the balance first.

```ts
// Check balance programmatically
const cp = new ChainPe({ privateKey, network: 'avalanche' })
const { usdc } = await cp.balance()
console.log('USDC balance:', usdc)
```

---

## 3. Service not found in registry

**Symptom:** `cp.discover()` returns empty, or indexer `/services` shows no results.

**Fixes:**
- Confirm the service is registered: `chainpe list`
- The registry address must match: check `CHAINPE_REGISTRY_ADDRESS=0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E` for mainnet
- The indexer may lag: check `chainpe-indexer-production.up.railway.app/health` and compare `lastIndexedBlock` to `chainHead`
- Try reading directly from the contract: `chainpe list` bypasses the indexer

---

## 4. PolicyVault spending limit exceeded

**Symptom:** `PolicyVaultClient.relaySpend()` throws with `"over per-call cap"`, `"over daily cap"`, or `"over total budget"`.

**Fixes:**
- Use `previewSpend()` to check before signing:
  ```ts
  const [ok, reason] = await publicClient.readContract({
    address: vaultAddress, abi: PolicyVaultAbi,
    functionName: 'previewSpend',
    args: [owner, to, amountAtomic]
  })
  if (!ok) console.error('Would fail:', reason)
  ```
- Check remaining budget: `vault.dailyRemaining(owner)` and `vault.budgetRemaining(owner)`
- Increase the cap by calling `setPolicy()` again (resets `totalSpent`)
- Deposit more USDC if `balanceOf[owner]` is insufficient

---

## 5. ICM message not received

**Symptom:** `ChainPeICMReceiver.intentCount()` does not increase after sending from the source chain.

**Fixes:**
- Verify the Teleporter messenger address is correct for the destination chain
- Check that `trustedSenders` is set correctly (or is `address(0)` to accept any sender)
- The ICM message delivery is asynchronous — wait a few blocks
- Use `MockTeleporterMessenger` in tests to simulate delivery synchronously
- Check that the `destinationBlockchainID` in the sender matches the receiver's chain

:::note
End-to-end ICM testing requires two live Avalanche L1s. Use the Hardhat test suite with `MockTeleporterMessenger` for local testing.
:::

---

## 6. Gas estimation failures

**Symptom:** `eth_estimateGas` reverts when calling `register()` or `spend()`.

**Fixes:**
- The most common cause is insufficient USDC approval. Approve the contract first:
  ```ts
  // For register(): approve ChainPeRegistry for the registration fee
  // For PolicyVault deposit(): approve the vault for the deposit amount
  ```
- For `register()`, check that `registrationFee` is 0.1 USDC (100000 atomic) and you have approved at least that amount
- Gas estimation can sometimes fail spuriously. Pass `gas: 300000n` explicitly as a fallback
- Gas estimation failures apply on any network — the same steps work for mainnet and Fuji testnet

---

## 7. Facilitator returning 503

**Symptom:** The facilitator's `/health` endpoint returns HTTP 503.

**Cause:** The facilitator gas key's AVAX balance has dropped below 0.05 AVAX.

**Fix:**
- Send AVAX to the facilitator gas key address on Avalanche C-Chain mainnet
- Check the current balance at `/status`
- Railway will automatically restart the service on 503, but the health check passes only when gas is sufficient

```bash
# Check facilitator status (includes gas balance)
curl https://chainpe-facilitator-production.up.railway.app/status
```

---

## 8. Indexer showing stale data

**Symptom:** A newly registered service does not appear in the indexer API.

**Cause:** The indexer polls on-chain events. There is a lag between the on-chain transaction and the indexer updating its cache.

**Fixes:**
- Wait 1-2 block polling cycles (typically < 30 seconds)
- Check the indexer's sync status: `GET /health` shows `lastIndexedBlock` vs `chainHead`
- For critical data, read directly from the contract instead of the indexer
- Use `chainpe list` which reads on-chain directly

---

## 9. Dashboard not connecting wallet

**Symptom:** The marketplace dashboard at `chainpe-dashboard-production.up.railway.app` shows a blank service list or MetaMask does not connect.

**Fixes:**
- Check the indexer health: if the indexer is down, the dashboard shows no services
- Add Avalanche C-Chain to MetaMask: chainId `43114`, RPC `https://api.avax.network/ext/bc/C/rpc`
- The dashboard reads `NEXT_PUBLIC_INDEXER_URL` — if it is misconfigured, the service list will be empty
- Try a hard refresh (Ctrl+Shift+R) to clear Next.js cached data
- For Fuji testnet development only, use chainId `43113`, RPC `https://api.avax-test.network/ext/bc/C/rpc`

---

## 10. npm publish failures

**Symptom:** `npm publish @chainpeavax/sdk` fails with "You do not have permission" or "Package already exists".

**Fixes:**
- Ensure you are logged in: `npm login` with the account that owns the `@chainpeavax` scope
- If the version already exists, bump the version in `packages/chainpe-sdk/package.json`
- Build before publishing: `npm run build` in the package directory (the `tsup.config.ts` outputs to `dist/`)
- Check `package.json` `files` field: ensure `dist/` is included

```bash
cd packages/chainpe-sdk
npm run build
npm publish --access public
```
