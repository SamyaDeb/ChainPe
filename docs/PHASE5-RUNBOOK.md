# Phase 5 runbook: portable reputation over ICM (Fuji C-Chain → our own Fuji L1)

A provider's payment-verified score lives in `ChainPeReputationOracle` on Fuji C-Chain. `ChainPeICMSender.sendReputation` reads it and sends it over Avalanche ICM (Teleporter) to `ChainPeReputationMirror` on **our own Fuji L1, "ChainPe"**, launched with the Builder Console. An agent on that L1 reads `getReputation(payTo)` before hiring.

This was **done on 2026-11-14**: a score of 87 from 12 paid reviews, set on Fuji C-Chain, was readable on the L1 **10.5 s** after the send confirmed. Links are in the [Run log](#run-log-2026-11-14).

All of this is **testnet only**. Every script checks that it is talking to Fuji (43113) and a separate L1, and refuses Avalanche mainnet. Every script that sends a transaction is a **dry run unless `EXECUTE=1`**.

```
Fuji C-Chain                                                         ChainPe L1 (Fuji, chain 278944)
ChainPeReputationOracle ─getEntry─► ChainPeICMSender ─Teleporter─► [icm-relayer] ─► TeleporterMessenger ─► ChainPeReputationMirror
   ▲ setScore (attester)            sendReputation(l1ID, mirror, payTo)                                  fail closed: only our sender from Fuji C
```

## Chains

| | Fuji C-Chain | ChainPe L1 |
|---|---|---|
| EVM chain ID | 43113 | 278944 |
| Blockchain ID (hex, from the Warp precompile) | `0x7fc93d85c6d62c5b2ac0b519c87010ea5294012d1e407030d6acd0021cac10d5` | `0xba255fac01c13b7b1ad8fe2e1321987e793f36f77ddee04e1947056087260a2b` |
| Blockchain ID (CB58) | `yH8D7ThNJkxmtkuv2jgBa4P1Rn3Qpr4pPr7QYNfcdoS6k6HWp` | `2QyrGkChHLjbi76A5uzwF2XEbfN5f3Krovs1j4qPtwe1BUP7h4` |
| Subnet ID | `11111111111111111111111111111111LpoYY` (primary network) | `243imxPhCqNHPpoFpBz2FX12HXeBeqgqnZHQHEi8BNtYzsyXTg` |
| RPC | `https://api.avax-test.network/ext/bc/C/rpc` | `https://managed-nodes.avax.network/ext/bc/2QyrGkChHLjbi76A5uzwF2XEbfN5f3Krovs1j4qPtwe1BUP7h4/rpc` |
| Gas token | AVAX | CHAIN |
| Explorer | https://testnet.snowtrace.io | https://build.avax.network/explorer/fuji/2QyrGkChHLjbi76A5uzwF2XEbfN5f3Krovs1j4qPtwe1BUP7h4 (client-rendered; open in a browser to confirm) |
| TeleporterMessenger | `0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf` | same (preinstalled by "Interoperability") |
| Validators | primary network | 1 managed node, `NodeID-JVjfgeiDaNLN566HLWvPJik1kLX77WDHn`, weight 100 |

**The L1 expires.** It was launched with the Builder Console's Quick L1. Its managed validator node and explorer are deleted **3 days after launch** (about 2026-11-17). After that the L1-side links stop working. The Fuji C-Chain side (the oracle, the sender, and the `setScore` and `sendReputation` txs with their `SendCrossChainMessage` event) stays on Snowtrace permanently.

### Why not Echo or Dispatch
Both public Fuji L1s have Teleporter, and Echo still receives messages from Fuji C-Chain. But neither has a dependable public relayer, and the faucets wouldn't give ECH to a new wallet that had no history. Our own L1 mints its gas token to the owner at launch, and it also earns the "own L1" bonus.

## Wallets

| Wallet | Address | Role | Key location (gitignored, mode 600) |
|---|---|---|---|
| Deployer | `0x88409A43B4Df744715a8a2baD213dC7B54B7e1B9` | owner of the oracle, sender and mirror; oracle attester; sends `setScore` and `sendReputation` | `contracts/.env` (`DEPLOYER_PRIVATE_KEY`) |
| Relayer | `0x546bB1b62D54C377631F25c8dfc36F5fC1e3177D` | delivers on the L1 (pays CHAIN gas). Must not sign anything else. | `contracts/icm-relayer/.env.relayer` (`ACCOUNT_PRIVATE_KEY`) |
| L1 owner / funder | `0x74E36d4A7b33057e3928CE4bf4C8C53A93361C34` | owns the L1 and got its 1,000,000 CHAIN at launch; funded the other two | `contracts/.env.funder`. This key was shared in chat, so treat it as exposed. **Testnet only.** |

Funding used:
- **Deployer:** 0.3 Fuji AVAX and 10 CHAIN. After the full run, the deployer still had about 0.3 AVAX and about 9.99 CHAIN.
- **Relayer:** 10 CHAIN. One delivery costs a few thousandths of a CHAIN at 1 gwei.

## Env (`contracts/.env`)

| Var | Value used |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | (secret) |
| `L1_NAME` | `chainpe-l1` |
| `L1_RPC_URL` | the ChainPe L1 RPC above |
| `L1_CHAIN_ID` | `278944` |
| `L1_EXPLORER_URL` | `https://build.avax.network/explorer/fuji/2QyrGkChHLjbi76A5uzwF2XEbfN5f3Krovs1j4qPtwe1BUP7h4` |
| `FUJI_RPC_URL` | default public Fuji RPC |
| `TELEPORTER_MESSENGER` | default `0x253b…5fcf` |

Optional:
- `REPUTATION_ORACLE`: reuse a Fuji oracle.
- `ATTESTER_ADDRESS`: attester for a new oracle (default: the deployer).
- `CHAINPE_REGISTRY`: Fuji registry v2, enabling `sendServiceReputation`.
- `CHAINPE_CLOUD_URL`: base URL for `MIRROR_FROM_MAINNET=1`.
- `RELAYER_BACKFILL_BLOCKS`: needs an RPC without the 100-block log limit.

## Steps

All commands run from `contracts/`.

### 0. Launch the L1 (browser, once)
1. Builder Console → **Create L1** (Quick L1) on Fuji, with **Interoperability** on.
2. The **owner wallet** receives the gas token at launch, so use a wallet whose key you hold.
3. It takes about 40 s.
4. Copy the RPC URL and the EVM chain ID into `.env`.

### 1. Tests
```bash
npx hardhat test          # must be green; live tests stay behind RUN_LIVE_E2E=1
```

### 2. Deploy (Fuji: oracle + sender; L1: mirror)
```bash
npm run icm-rep:deploy                 # dry run: chain checks, Teleporter code, balances, plan
EXECUTE=1 npm run icm-rep:deploy
```
This writes `deployments/fuji-icm-reputation.json` and `deployments/fuji-reputation-oracle.json`.

### 3. Configure (the mirror trusts the Fuji sender)
```bash
npm run icm-rep:configure
EXECUTE=1 npm run icm-rep:configure    # 1 L1 tx: mirror.setTrustedSender(fujiBlockchainID, sender)
```
The blockchain IDs are read from the Warp precompile, not hardcoded. Until this step is done, the mirror rejects everything (it fails closed).

### 4. Relayer (self-hosted, Docker)
```bash
npm run icm-rep:relayer-key            # once: writes icm-relayer/.env.relayer, prints the address only
# fund that address with the L1 gas token
npm run icm-rep:relayer-config         # writes icm-relayer/config.json (no key inside)
docker run -d --name chainpe-icm-relayer \
  --env-file icm-relayer/.env.relayer \
  -v "$PWD/icm-relayer/config.json:/config.json:ro" \
  -p 8080:8080 \
  avaplatform/icm-relayer:v1.8.4 --config-file /config.json
docker logs -f chainpe-icm-relayer
```
`config.json` is in the icm-relayer v1.8.x format, without the `vm` fields (removed in v1.7.5):
- **Source:** Fuji C-Chain's Teleporter.
- **`allowed-origin-sender-addresses`:** only our `ChainPeICMSender`.
- **`supported-destinations`:** only the ChainPe L1, and only the mirror address.

Two things learned on the real run:
- **Storage.** The image runs as a non-root user and can't write to a fresh Docker volume ("permission denied"), so state lives in `/tmp` inside the container.
- **Back-fill is fatal on the public RPC.** The public Fuji RPC caps `eth_getLogs` at 100 blocks, and the relayer back-fills in 200-block chunks. So the relayer starts **at the chain tip** (`process-missed-blocks: false`). Start it **before** sending. A message sent while it was down needs a resend, or a provider RPC with `RELAYER_BACKFILL_BLOCKS`.
- **Startup noise you can ignore:** `Not enough connected stake for subnet 243imx…` at startup. It connected to the L1 validator when it needed a signature. For a message from the C-Chain, the signature comes from the **destination** L1's validators.

### 5. Send and confirm
```bash
npm run icm-rep:send                                     # dry run
EXECUTE=1 SCORE=87 REVIEWS=12 npm run icm-rep:send       # what was run
EXECUTE=1 MIRROR_FROM_MAINNET=1 PAYTO=0x... npm run icm-rep:send   # score "mirrored from mainnet by the attester"
```
The script prints:
- the `setScore` and `sendReputation` links
- the Teleporter `messageID`
- the L1 delivery tx and the mirror state
- the elapsed time

It also appends everything to `demoSends` in `deployments/fuji-icm-reputation.json`.

`MIRROR_FROM_MAINNET=1` reads `GET /v1/public/services` from chainpe-cloud. On 2026-11-14 the hosted instance answered **404**: the route is in the source but isn't deployed. Until chainpe-cloud is redeployed, pass `SCORE`/`REVIEWS`.

### If it doesn't arrive
1. Check the `messageID` and the `SendCrossChainMessage` log in the Fuji tx on Snowtrace.
2. `docker logs chainpe-icm-relayer`. The healthy sequence is: `Unpacked message` → `Relaying message` → `Created signed message.` → `Delivered message to destination chain`.
   - **Exited?** Read the `fatal` line (see the two issues in step 4).
   - **Nothing after `Listener initialized`?** Check the sender address in the allowlist.
3. On a timeout, `send-reputation.ts` searches the L1 Teleporter logs for the `messageID`. If there's a log but no mirror change, look for `MessageExecutionFailed` (a stale timestamp, or no trusted sender). Teleporter's `retryMessageExecution` can re-run it.
4. Check the relayer's balance on the L1.

## Run log (2026-11-14)

| Step | Chain | Address / tx |
|---|---|---|
| ChainPeReputationOracle | Fuji | [`0x2193ED88f7e144D6679405CcBaFB0DDd4d545e84`](https://testnet.snowtrace.io/address/0x2193ED88f7e144D6679405CcBaFB0DDd4d545e84), deploy [`0x8a6522…6e81`](https://testnet.snowtrace.io/tx/0x8a652235ad8933433c4b1e2c9bed48993c9c8ca0d21096de366f04f846be6e81) |
| ChainPeICMSender | Fuji | [`0xD2552df223d370056D6CA6d3a4a4aEDf855197CF`](https://testnet.snowtrace.io/address/0xD2552df223d370056D6CA6d3a4a4aEDf855197CF), deploy [`0xde2d06…0239`](https://testnet.snowtrace.io/tx/0xde2d060b0c30aa1b7e9dd5d33324dde4e1d6c6f90a021ac2e50afb6f84050239) |
| ChainPeReputationMirror | ChainPe L1 | `0x2193ED88f7e144D6679405CcBaFB0DDd4d545e84` (same address as the oracle: the deployer's nonce 0 on each chain), deploy `0x27d7eec5f522fe19acb88841ad0ddcc7d842333885b98ad8edef01df7f6d9249` |
| setTrustedSender | ChainPe L1 | `0x91052ac1caa6e048e5403a560acbb9582cd779f96dbeac6b057aec93d7aa1260` |
| setScore(87, 12 reviews) | Fuji | [`0x241e69…7523`](https://testnet.snowtrace.io/tx/0x241e69a56c91e2f2a85bf712cea1419f96e8b1f05875d8a1a38ada15dfd97523) |
| sendReputation | Fuji | [`0xcb7aa4…c658`](https://testnet.snowtrace.io/tx/0xcb7aa4411b8e176d17fb8b8f4767942498563a11223971e6fe8ba536c63fc658), messageID `0xa657a4738aa4f7e40cdfaf544ba7d99313380c27af3df418a2c0e1c2cbb1e5b3` |
| Delivery (by relayer `0x546b…177D`) | ChainPe L1 | `0x67f98802f8cc90aae98555bbf40bbb7607165795344d5890420eab5306d0fb2f` (block 5, status 1); [explorer](https://build.avax.network/explorer/fuji/2QyrGkChHLjbi76A5uzwF2XEbfN5f3Krovs1j4qPtwe1BUP7h4/tx/0x67f98802f8cc90aae98555bbf40bbb7607165795344d5890420eab5306d0fb2f) |
| Mirror read-back | ChainPe L1 | `getReputation(0xd096…AD24)` = score 87, 12 paid reviews, agentId 0, source `0x7fc93d…10d5` (Fuji C-Chain) |
| Elapsed | | 10.5 s after the send confirmed (14 s between block timestamps) |

Funding txs:
- Fuji, 0.3 AVAX funder→deployer: [`0x95f20b…dac9`](https://testnet.snowtrace.io/tx/0x95f20b9b1958021da9da075a902a5094df979390bb6f471d830a383a16f5dac9)
- L1, 10 CHAIN funder→deployer: `0xa7e3a9e793870cf8bd3b356827f97aa3ef7c276a88ca1e2a57e435f93ba59c52`
- L1, 10 CHAIN funder→relayer: `0xf81e111778f0989337643a1f67d8dcc9546cfdfb14817515788140278229a570`

The demo payTo `0xd096Cb77B04AADc533b1B69ef9A1CF52b488AD24` is a fixed placeholder (`keccak("chainpe-phase5-demo-provider")`). The score is a demo value set by the attester on Fuji. It is **not** a real provider's mainnet score.

## What this does and does not prove
- **Proves:** a score written to the Fuji C-Chain oracle reaches a contract on another Avalanche L1 over Teleporter in about 10 s. The mirror accepts it only from our sender on Fuji C-Chain, and never accepts an older score over a newer one.
- **Doesn't prove:** anything on mainnet. The mainnet `ChainPeICMReceiver` (`0xc8aB…6D33`) is the older, open-by-default build, configured only as a C-Chain→C-Chain loopback.
- **Relayer:** ours, running in Docker on the dev machine. Messages sent while it's down aren't back-filled (public-RPC limit).
- **The L1 is temporary:** a 3-day testnet L1. Its explorer links stop working after it expires.
- **agentId:** `sendReputation` sends agentId 0 (unlinked). `sendServiceReputation` links it from the registry, but no Fuji registry v2 is wired in.
