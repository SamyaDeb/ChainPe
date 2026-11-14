/**
 * Phase 5: make the L1 mirror trust the Fuji C-Chain ChainPeICMSender.
 *
 * Both blockchain IDs are read live from the Warp precompile (0x0200…0005) on each chain, never hardcoded,
 * and cross-checked against deployments/fuji-icm-reputation.json.
 *
 * Dry run (default):  npx hardhat run scripts/configure-icm-reputation.ts
 * Execute:            EXECUTE=1 npx hardhat run scripts/configure-icm-reputation.ts
 *
 * The wallet (DEPLOYER_PRIVATE_KEY) must own the mirror. One tx on the L1, none on Fuji.
 */
import {
  L1_NAME, connect, blockchainIdOf, toCb58, contractAt, printBalances, isExecute,
  loadDeployment, saveDeployment, l1Tx,
} from "./lib/icmReputation";

async function main() {
  const c = await connect();
  const d = loadDeployment();
  const [fujiId, l1Id] = await Promise.all([blockchainIdOf(c.fuji.provider!), blockchainIdOf(c.l1.provider!)]);
  if (d.fuji.blockchainID && d.fuji.blockchainID !== fujiId) throw new Error(`Fuji blockchainID changed: file ${d.fuji.blockchainID}, chain ${fujiId}`);
  if (d.l1.blockchainID && d.l1.blockchainID !== l1Id) throw new Error(`${L1_NAME} blockchainID mismatch: file ${d.l1.blockchainID}, chain ${l1Id}. Wrong L1_RPC_URL?`);

  const mirror = await contractAt("ChainPeReputationMirror", d.l1.chainPeReputationMirror, c.l1);
  const owner: string = await mirror.owner();
  const current: string = await mirror.trustedSenders(fujiId);

  console.log(`\nConfigure ${L1_NAME} mirror ${d.l1.chainPeReputationMirror}`);
  await printBalances(c);
  console.log(`  Mirror owner:          ${owner}`);
  console.log(`  Source (Fuji C-Chain): ${fujiId} (${toCb58(fujiId)})`);
  console.log(`  Trusted sender now:    ${current === "0x0000000000000000000000000000000000000000" ? "(none, rejects all)" : current}`);
  console.log(`  Set to:                ${d.fuji.chainPeICMSender}`);

  if (owner.toLowerCase() !== c.l1.address.toLowerCase()) throw new Error(`Wallet ${c.l1.address} does not own the mirror`);
  if (current.toLowerCase() === d.fuji.chainPeICMSender.toLowerCase()) return console.log("\n  Already configured. Nothing to do.\n");
  if (!isExecute()) return console.log("\n  Dry run only. Re-run with EXECUTE=1 to send setTrustedSender.\n");

  const tx = await mirror.setTrustedSender(fujiId, d.fuji.chainPeICMSender);
  await tx.wait();
  const after: string = await mirror.trustedSenders(fujiId);
  if (after.toLowerCase() !== d.fuji.chainPeICMSender.toLowerCase()) throw new Error(`trustedSenders read back ${after}`);
  console.log(`\n  ✓ setTrustedSender ${l1Tx(tx.hash)}`);

  d.fuji.blockchainID = fujiId; d.fuji.blockchainIDCb58 = toCb58(fujiId);
  d.l1.blockchainID = l1Id; d.l1.blockchainIDCb58 = toCb58(l1Id);
  d.l1.trustedSenderTx = tx.hash;
  saveDeployment(d);
  console.log("  Saved trustedSenderTx -> deployments/fuji-icm-reputation.json");
  console.log("\n  Next: npx hardhat run scripts/make-relayer-config.ts, start the relayer, then send-reputation.ts.\n");
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
