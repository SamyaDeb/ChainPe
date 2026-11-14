/**
 * Phase 5: deploy portable reputation (Fuji C-Chain -> Fuji L1, default Echo).
 *
 *   Fuji C-Chain: ChainPeReputationOracle (only if none recorded) + ChainPeICMSender(teleporter, oracle, registry)
 *   L1:           ChainPeReputationMirror(teleporter)
 *
 * Dry run (default): checks both chains, Teleporter, balances, and prints the plan. Sends nothing.
 *   npx hardhat run scripts/deploy-icm-reputation.ts
 * Deploy:
 *   EXECUTE=1 npx hardhat run scripts/deploy-icm-reputation.ts
 *
 * Env (besides scripts/lib/icmReputation.ts):
 *   REPUTATION_ORACLE   reuse an existing Fuji oracle (else deployments/fuji-reputation-oracle.json, else deploy one)
 *   ATTESTER_ADDRESS    attester for a newly deployed Fuji oracle (default: the deployer, so send-reputation.ts can seed)
 *   CHAINPE_REGISTRY    ChainPe registry v2 on Fuji for sendServiceReputation (default: none = disabled)
 *
 * Writes deployments/fuji-icm-reputation.json (and deployments/fuji-reputation-oracle.json if it deploys an oracle,
 * so scripts/publish-scores.ts --network fuji works against it).
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import {
  TELEPORTER, L1_NAME, L1_RPC_URL, L1_EXPLORER, DEPLOYMENT_FILE,
  connect, assertTeleporter, blockchainIdOf, toCb58, factory, printBalances, isExecute, saveDeployment,
  fujiAddr, fujiTx, l1Addr, l1Tx,
} from "./lib/icmReputation";

const ORACLE_FILE = path.join(__dirname, "..", "deployments", "fuji-reputation-oracle.json");

async function main() {
  const c = await connect();
  console.log(`\nPhase 5 deploy: Fuji C-Chain -> ${L1_NAME} (${L1_RPC_URL})`);
  await Promise.all([assertTeleporter(c.fuji.provider!, "Fuji C-Chain"), assertTeleporter(c.l1.provider!, L1_NAME)]);
  const [fujiId, l1Id] = await Promise.all([blockchainIdOf(c.fuji.provider!), blockchainIdOf(c.l1.provider!)]);
  console.log(`  Teleporter:        ${TELEPORTER} (code present on both chains)`);
  console.log(`  Fuji blockchainID: ${fujiId} (${toCb58(fujiId)})`);
  console.log(`  ${L1_NAME} blockchainID: ${l1Id} (${toCb58(l1Id)})`);
  const bal = await printBalances(c);

  if (fs.existsSync(DEPLOYMENT_FILE) && process.env.FORCE !== "1") {
    throw new Error(`${path.basename(DEPLOYMENT_FILE)} already exists. Set FORCE=1 to deploy a fresh set.`);
  }

  let oracle = process.env.REPUTATION_ORACLE ?? "";
  if (!oracle && fs.existsSync(ORACLE_FILE)) oracle = JSON.parse(fs.readFileSync(ORACLE_FILE, "utf8")).oracle;
  if (oracle && (await c.fuji.provider!.getCode(oracle)) === "0x") throw new Error(`No contract at oracle ${oracle} on Fuji`);
  const attester = process.env.ATTESTER_ADDRESS ?? c.fuji.address;
  const registry = process.env.CHAINPE_REGISTRY ?? ethers.ZeroAddress;

  console.log("\n  Plan:");
  console.log(oracle ? `    Fuji: reuse ChainPeReputationOracle ${oracle}` : `    Fuji: deploy ChainPeReputationOracle(owner=${c.fuji.address}, attester=${attester})`);
  console.log(`    Fuji: deploy ChainPeICMSender(${TELEPORTER}, oracle, registry=${registry})`);
  console.log(`    ${L1_NAME}: deploy ChainPeReputationMirror(${TELEPORTER})`);

  if (bal.fuji === 0n || bal.l1 === 0n) console.log("\n  ! Wallet needs funds on BOTH chains (see docs/PHASE5-RUNBOOK.md).");
  if (!isExecute()) return console.log("\n  Dry run only. Re-run with EXECUTE=1 to deploy.\n");

  let oracleTx: string | null = null;
  if (!oracle) {
    const o = await (await factory("ChainPeReputationOracle", c.fuji)).deploy(c.fuji.address, attester);
    oracleTx = o.deploymentTransaction()!.hash;
    await o.waitForDeployment();
    oracle = await o.getAddress();
    console.log(`\n  ChainPeReputationOracle  ${oracle}\n    ${fujiTx(oracleTx)}`);
    if (!fs.existsSync(ORACLE_FILE)) {
      fs.writeFileSync(ORACLE_FILE, JSON.stringify({ network: "fuji", oracle, owner: c.fuji.address, attester, deployTx: oracleTx, deployedAt: new Date().toISOString() }, null, 2) + "\n");
    }
  }

  const s = await (await factory("ChainPeICMSender", c.fuji)).deploy(TELEPORTER, oracle, registry);
  const senderTx = s.deploymentTransaction()!.hash;
  await s.waitForDeployment();
  const sender = await s.getAddress();
  console.log(`  ChainPeICMSender         ${sender}\n    ${fujiTx(senderTx)}`);

  const m = await (await factory("ChainPeReputationMirror", c.l1)).deploy(TELEPORTER);
  const mirrorTx = m.deploymentTransaction()!.hash;
  await m.waitForDeployment();
  const mirror = await m.getAddress();
  console.log(`  ChainPeReputationMirror  ${mirror} (${L1_NAME})\n    ${l1Tx(mirrorTx)}`);

  const l1Net = await c.l1.provider!.getNetwork();
  saveDeployment({
    note: "Phase 5 portable reputation on testnet. Fuji C-Chain oracle -> ICM (Teleporter) -> L1 mirror.",
    teleporterMessenger: TELEPORTER,
    deployer: c.fuji.address,
    fuji: {
      chainId: 43113, blockchainID: fujiId, blockchainIDCb58: toCb58(fujiId),
      reputationOracle: oracle, reputationOracleDeployTx: oracleTx,
      chainPeICMSender: sender, chainPeICMSenderDeployTx: senderTx, registry,
    },
    l1: {
      name: L1_NAME, chainId: Number(l1Net.chainId), rpcUrl: L1_RPC_URL, explorer: L1_EXPLORER,
      blockchainID: l1Id, blockchainIDCb58: toCb58(l1Id),
      chainPeReputationMirror: mirror, chainPeReputationMirrorDeployTx: mirrorTx,
    },
    deployedAt: new Date().toISOString(),
  });
  console.log(`\n  Saved -> deployments/${path.basename(DEPLOYMENT_FILE)}`);
  console.log(`  ${fujiAddr(sender)}\n  ${l1Addr(mirror)}`);
  console.log("\n  Next: configure-icm-reputation.ts (mirror trusts the sender), then the relayer.\n");
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
