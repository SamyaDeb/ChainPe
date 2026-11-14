# Phase 3 runbook: payment-gated reputation

Everything here is **run by you**. The code is written and tested; nothing below has been executed against mainnet.
Every script that sends a transaction is a **dry run by default** and only sends with `EXECUTE=1`.

> **Dependency on Phase 2.4.** Steps (d)–(f) need the three demo services (`weather`, `summarize`, `cheap-weather`)
> deployed on Railway and registered on mainnet with **their own wallet and their own ERC-8004 identity each**
> (`examples/weather-railway` + `examples/proxy-railway`, `register.sh`). As of writing they are not registered (the
> mainnet registry has 0 services), so run Phase 2.4 first, or after step (a) (either order works).

## Order of operations

| # | Step | Needs | Reversible |
|---|------|-------|-----------|
| 0 | Run the tests once more | – | – |
| 1 | (c) Deploy chainpe-cloud | Railway | yes (redeploy previous) |
| 2 | (a) Upgrade the registry on mainnet | owner key, AVAX | yes (upgrade again) |
| 2b | Reserve ERC-8004 agent #0 (`scripts/reserve-agent-zero.ts`) | owner key, ≈0.005 AVAX | no (one NFT minted) |
| 3 | Phase 2.4: deploy + register the three services | 3 wallets, 3 USDC + gas | – |
| 4 | (b) Hijack-attempt proof | any funded wallet | n/a (reverts) |
| 5 | (d)(e) Seed reputation | 3–5 funded wallets | no (real payments + ratings) |
| 6 | (f) Verify via the public API | – | – |
| 7 | Optional: Step B, on-chain PolicyVault gate | owner key, AVAX | yes, but changes the signing format |
| 8 | Publish packages / rebuild the wallet bundle | npm | – |

Reserve agent #0 (2b) **before** step 3. The IdentityRegistry numbers agents from 0, and ChainPe treats agentId 0
as "no agent linked", so the registry's ownership check can never protect #0. On mainnet no agent exists yet, so the
first `chainpe register` would otherwise mint #0 to a real provider:

```bash
cd contracts
npx hardhat run scripts/reserve-agent-zero.ts --network avalanche            # dry run
EXECUTE=1 npx hardhat run scripts/reserve-agent-zero.ts --network avalanche  # mint #0 to the deployer
```

Deploy chainpe-cloud (1) **before** seeding (5): it is what verifies ratings. Upgrade the registry (2) **before**
the demo services link agent ids, so the `NotAgentOwner` check covers them from day one.

```bash
# 0. sanity
cd contracts && npx hardhat test                       # 135 passing, 5 pending (live tests)
cd .. && npm run build && npm test                     # root
cd services/chainpe-cloud && npm test                  # needs Postgres (see its README)
```

---

## (a) Upgrade the registry on mainnet

The proxy `0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E` is owned by the deployer EOA. The upgrade adds the agentId
ownership check to `register()`/`update()`, lets `deregister()` work while paused, and adds `getVersion()` (`"2.0.0"`).
**No storage changes.**

**Burn agent id 0 first (once).** The mainnet Identity Registry is empty and 0-indexed, so the *first* agent minted
gets id **0**, which the registry treats as "unlinked". If `weather` ended up as agent #0 it could never be linked.
Before registering the demo services, mint a throwaway identity from any wallet and discard it:

```bash
cast call 0xB1330d7B1b083ba689C7f56bDf667F1F528a3195 "ownerOf(uint256)(address)" 0 --rpc-url https://api.avax.network/ext/bc/C/rpc
# "ERC721NonexistentToken" ⇒ id 0 is free. Burn it:
cast send 0xB1330d7B1b083ba689C7f56bDf667F1F528a3195 "register(string)" "ipfs://placeholder" \
  --private-key $ANY_FUNDED_KEY --rpc-url https://api.avax.network/ext/bc/C/rpc
```

**Dry run** (validates the storage layout against the frozen v1 source, checks the owner, estimates gas, sends nothing):

```bash
cd contracts
DEPLOYER_PRIVATE_KEY=0x<owner key> npx hardhat run scripts/upgrade-registry.ts --network avalanche
```

**Rehearse against real mainnet state** (needs `anvil`; no key, no transactions):

```bash
RUN_LIVE_E2E=1 npx hardhat test test/ChainPeRegistry.agentOwnership.test.ts
```

**Execute** (2 txs: deploy the new implementation, then `upgradeToAndCall` on the proxy):

```bash
DEPLOYER_PRIVATE_KEY=0x<owner key> EXECUTE=1 npx hardhat run scripts/upgrade-registry.ts --network avalanche
```

The script re-reads every service after the upgrade and aborts loudly on any difference, then writes
`chainPeRegistryImpl`, `chainPeRegistryImplPrev`, `registryV2UpgradeTx` and `registryV2UpgradedAt` into
`contracts/deployments/avalanche.json`. **Save the upgrade tx hash for the README.**

**Verify on Snowtrace**

```bash
npx hardhat verify --network avalanche <new implementation address printed by the script>
```

(Routescan accepts any non-empty API key; the config already points at it.) Then on
`https://snowtrace.io/address/0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E`:

1. **Contract → Read as Proxy**: `getVersion()` returns `2.0.0`; `getServiceCount()` is unchanged from before.
2. The **implementation** link now points at the new address, with the green verified check and the `NotAgentOwner` error
   in its ABI.
3. **Events → Upgraded** shows the `upgradeToAndCall` tx.

Cross-check from a terminal:

```bash
cast call 0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E "getVersion()(string)" --rpc-url https://api.avax.network/ext/bc/C/rpc
cast storage 0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url https://api.avax.network/ext/bc/C/rpc
```

**Rollback:** services registered before the upgrade could have linked an agent id they don't own (v1 never checked).
They keep working, but anyone who later calls `update()` on one must own that agent. If something looks wrong, upgrade
back to `chainPeRegistryImplPrev` with `cast send <proxy> "upgradeToAndCall(address,bytes)" <prev> 0x`.

---

## (b) Proof that a hijack reverts (for the README)

Sends a **real** transaction from a wallet that does not own the victim agent. It reverts with `NotAgentOwner(agentId)`.
It costs gas only (the check runs before the 1 USDC fee is taken). The script refuses to run against an un-upgraded
registry, where it would *succeed*.

```bash
cd contracts
# simulate only
ATTACKER_PRIVATE_KEY=0x<any funded wallet, ~0.01 AVAX> npx hardhat run scripts/hijack-attempt.ts --network avalanche
# mine the reverted tx (VICTIM_AGENT_ID optional: defaults to the first live service's agent)
ATTACKER_PRIVATE_KEY=0x... EXECUTE=1 npx hardhat run scripts/hijack-attempt.ts --network avalanche
```

It prints the tx hash and `status: 0 (REVERTED, as expected)`. On Snowtrace the tx shows **Status: Fail** with the
`NotAgentOwner` error. Put that link in the README. Run it **after** step 3, so there is a real linked agent to target.

---

## (c) chainpe-cloud: migration and redeploy on Railway

Migration `services/chainpe-cloud/drizzle/0002_phase3_payment_gated_reputation.sql` runs **automatically at boot**
(`runMigrations` in `src/server.ts`). It adds to `feedback`: `feedback_hash`, `verified`, `verification_reason`,
`paid_atomic`, `paid_to`, `payment_tx`, `verify_attempts`, `next_verify_at` (plus the unique index "one payment, one
verified rating"), adds `services.agent_id`, and marks pre-existing ratings `no_proof`. It is additive; nothing is
dropped.

1. Commit and push the branch (you commit manually).
2. Deploy the `chainpe-cloud` service (it builds from `services/chainpe-cloud/Dockerfile.with-dashboard` or
   `Dockerfile`, whichever the service already uses):
   ```bash
   cd services/chainpe-cloud && railway up --service chainpe-cloud     # or push to the connected branch
   ```
3. **Env vars: none are required.** Optional: `PUBLIC_CORS_ORIGIN` (extra origins that may read `/v1/public/*`).
   `https://chainpe.vercel.app` and every `SIWE_DOMAIN` host are always allowed. `WORKERS_ENABLED` must stay `true`
   (the verifier runs with the indexer).
4. Watch the deploy logs for `chainpe-cloud (Avalanche 43114) on :4700, workers on` and no migration error.
5. Smoke test:
   ```bash
   B=https://chainpe-cloud-production-1d71cb77.up.railway.app
   curl -s $B/health
   curl -s $B/v1/public/stats
   curl -s -H 'Origin: https://chainpe.vercel.app' -i $B/v1/public/services | grep -i access-control-allow-origin
   ```
6. **Backfill.** `services.agent_id` is filled when the indexer sees a `ServiceRegistered`/`ServiceUpdated` event. The
   registry is empty, so nothing needs backfilling. If services existed before this deploy, re-emit their events with
   an `update()` from each developer, or reset the cursor to re-scan (`DELETE FROM indexer_state;`, slow on the public
   RPC at 100 blocks per call).

**Rollback:** redeploy the previous image. The new columns are ignored by the old code.

---

## (d) Seed the reputation data

`e2e/seed-reputation.mjs` spends **real USDC and AVAX**. Use 3–5 wallets that are **not** any provider's wallet (the
registry blocks an agent's owner from rating it).

```bash
export SEED_KEYS=0xkey1,0xkey2,0xkey3,0xkey4
node e2e/seed-reputation.mjs                 # dry run: prints the plan and checks balances, sends nothing
EXECUTE=1 node e2e/seed-reputation.mjs       # does it
```

What it does, with the defaults:

- each paying wallet pays `weather` 3× and `summarize` 3×, rating each call 90–100, with the settlement tx attached
  as `feedbackHash`
- each paying wallet pays `cheap-weather` once and rates it 5–25 (also verified)
- 5 fresh wallets are funded with 0.03 AVAX and each posts **3 unpaid ratings of 100** to `cheap-weather` (no payment,
  no `feedbackHash`). The throwaway keys are saved to `e2e/.seed-unpaid-wallets.json` (gitignored) so you can sweep the
  leftover AVAX.

Why 3 unpaid ratings per wallet rather than 1: with only 5 unpaid 100s against 3–5 paid low ratings the raw average
lands near 50, not "high". 15 unpaid ratings give about 80 raw against about 15 paid. Tune with `CALLS_GOOD`,
`CALLS_CHEAP`, `UNPAID_RATERS`, `UNPAID_PER_WALLET`.

Requirements it checks before spending: all three services are on chainpe-cloud, each has an agent id, `cheap-weather`
has its own agent id (a shared one would mix the ratings), and no rater is a provider wallet.

**Settlement tx:** the proxy must return the facilitator's `X-PAYMENT-RESPONSE` header (with `transaction`) so the
client can attach it. The seed script skips (and says so) any call that returns no tx.

## (e) What each wallet needs

Prices: weather 0.01, summarize 0.02, cheap-weather 0.005 USDC (from `register.sh`).

| Wallet | USDC | AVAX | For |
|---|---|---|---|
| each of 3–5 paying wallets | ≈ 0.12 (spends 0.095) | ≈ 0.07 (7 ratings × ~0.01 gas, mostly refunded in practice) | 3 weather + 3 summarize + 1 cheap-weather, and their ratings |
| funder (default: the first paying wallet) | – | + 0.15 | 5 fresh wallets × 0.03 AVAX |
| registry owner (step a) | – | ≈ 0.15 | deploy the implementation + `upgradeToAndCall` |
| attacker wallet (step b) | – | ≈ 0.01 | one reverted tx |
| each of the 3 provider wallets (Phase 2.4) | 1 (registration fee) + a little for the identity | ≈ 0.02 | register + mint identity |
| facilitator | – | existing balance | pays settlement gas; make sure it holds enough for ~(4×7)+ settlements |

With 4 paying wallets the total is about 0.4 USDC and 0.45 AVAX, plus the 3 USDC registration fees.

## (f) Confirm: high raw score, low paid score

chainpe-cloud verifies each rating within about a minute of it being indexed (the indexer reads 100 blocks at a time on
the public RPC, so allow a few minutes).

```bash
B=https://chainpe-cloud-production-1d71cb77.up.railway.app
curl -s $B/v1/public/services | jq '.services[] | {name, paidScore, paidReviews, rawScore, rawReviews, totalSettledAtomic, paidCalls}'
```

Expected shape (numbers will differ):

```json
{ "name": "weather",       "paidScore": 96, "paidReviews": 12, "rawScore": 96, "rawReviews": 12 }
{ "name": "summarize",     "paidScore": 95, "paidReviews": 12, "rawScore": 95, "rawReviews": 12 }
{ "name": "cheap-weather", "paidScore": 14, "paidReviews": 4,  "rawScore": 80, "rawReviews": 19 }
```

`cheap-weather` shows a **high raw** score (the 15 unpaid ratings) and a **low paid** score (only the verified ones).
The unpaid ones appear in the reviews list as `unverified`, reason `no_proof`:

```bash
KEY=$(curl -s $B/v1/public/services | jq -r '.services[] | select(.name=="cheap-weather") | .key')
curl -s "$B/v1/public/services/$KEY/reviews?limit=50" | jq '.reviews[] | {score, status, verificationReason, paymentTx}'
curl -s $B/v1/public/feed?limit=10 | jq .
```

Or let the script assert it (exits non-zero on failure):

```bash
node e2e/seed-reputation.mjs --check
```

Then try the gate end to end:

- **MCP wallet:** set `MIN_REPUTATION=60` (Claude Desktop → the extension's "Minimum Provider Reputation"). Ask Claude to
  call `cheap-weather`: `x402_fetch` replies `REFUSED, nothing was signed and no money moved…`; `weather` pays.
- **SDK:** `new ChainPe({ privateKey, minReputation: 60 })` throws `ReputationTooLow` before signing for `cheap-weather`.

---

## Optional: Step B, the on-chain PolicyVault gate

Everything above works without this. This makes the **vault itself** refuse to pay a low-scoring provider even if the
agent is compromised.

**Read this first:** `SPEND_TYPEHASH` gained an `epoch` field, so **every spend authorization signed before the upgrade
stops working**, and clients must use the updated `@chainpeavax/sdk` (`PolicyVaultClient`; it auto-detects v1 vs v2).
Upgrade when nothing is in flight. Also: `setPolicy` no longer resets `totalSpent` (totalBudget is now a lifetime cap;
raise it to allow more), and it bumps the session epoch.

```bash
cd contracts
# rehearse on a fork (needs anvil)
RUN_LIVE_E2E=1 npx hardhat test test/PolicyVault.reputationGate.test.ts
# dry run: layout validation + gas
ATTESTER_ADDRESS=0x<dedicated hot key, NOT the owner> DEPLOYER_PRIVATE_KEY=0x<owner> \
  npx hardhat run scripts/upgrade-policyvault.ts --network avalanche
# execute: deploys the oracle + new vault implementation, upgrades, points the vault at the oracle (4 txs)
ATTESTER_ADDRESS=0x... DEPLOYER_PRIVATE_KEY=0x<owner> EXECUTE=1 \
  npx hardhat run scripts/upgrade-policyvault.ts --network avalanche
```

It writes the oracle and the new tx hashes into `deployments/avalanche-policyvault.json` and
`avalanche-reputation-oracle.json`. Verify:

```bash
npx hardhat verify --network avalanche <vault impl>
npx hardhat verify --network avalanche <oracle> <owner> <attester>
```

Publish scores to the oracle (run it with the **attester** key, on a schedule shorter than the oracle's `maxAge`):

```bash
DEPLOYER_PRIVATE_KEY=0x<attester> npx hardhat run scripts/publish-scores.ts --network avalanche            # dry run
DEPLOYER_PRIVATE_KEY=0x<attester> EXECUTE=1 npx hardhat run scripts/publish-scores.ts --network avalanche
```

Each vault owner then opts in: `vault.setMinScore(60)` (SDK: `new PolicyVaultClient(...).setMinScore(60)`). A spend to a
recipient the oracle rates below 60, unrated, or with fewer than 3 verified paid reviews reverts with
`ProviderReputationTooLow`. With a minimum set and no oracle configured it reverts `ReputationOracleNotSet` (fails
closed).

The oracle's trust model: the attester can only report scores (it cannot move funds) and the owner can replace it.
It is a trusted publisher of chainpe-cloud's numbers, not a trustless computation.

---

## Ticking the plan

After you have run the above, tick in `docs/SPEEDRUN-PLAN.md`:

- 3.3: "Upgrade on mainnet with the owner key. Save the tx hash."
- 3.6 (all three) once `--check` passes
- 3.5 Step B: "Run validateUpgrade, add tests, upgrade on mainnet, save the tx hashes."
- "Done when": the public API shows paid ≠ raw for `cheap-weather`; MCP wallet with `MIN_REPUTATION=60` refuses it and
  pays `weather`; registry upgrade is live and the hijack tx is saved.

## Publishing (step 8)

The `MIN_REPUTATION` gate and payment-proof ratings only reach users once the packages are released. Not done by the
Phase 3 work (no npm publish): bump versions, then `npm run publish:cli`, publish `@chainpeavax/sdk` and
`@chainpeavax/agent`, and rebuild the Claude Desktop bundle with `npm run build:mcpb` (the manifest gained the
`min_reputation` setting).
