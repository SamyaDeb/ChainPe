/**
 * Phase 5 demo: seed a score in the Fuji oracle, send it over ICM, and wait until the L1 mirror has it.
 *
 *   1. (unless SKIP_SEED=1) oracle.setScore(payTo, score, paidReviews) on Fuji. The wallet must be an oracle attester.
 *   2. sender.sendReputation(l1BlockchainID, mirror, payTo) on Fuji.
 *   3. Poll mirror.getReputation(payTo) on the L1 until the oracle's updatedAt arrives, find the delivery tx,
 *      and print both explorer links and the elapsed time.
 *
 * Dry run (default):  npx hardhat run scripts/send-reputation.ts
 * Execute:            EXECUTE=1 npx hardhat run scripts/send-reputation.ts
 *
 * Score source (pick one):
 *   MIRROR_FROM_MAINNET=1   take paidScore / paidReviews from chainpe-cloud's public API (mainnet data) for PAYTO,
 *                           or for the first eligible service if PAYTO is unset. Labelled "mirrored from mainnet
 *                           by the attester". CHAINPE_CLOUD_URL overrides the API base.
 *   otherwise               SCORE (default 80) and REVIEWS (default 5) for PAYTO (default: a fixed demo address).
 *
 *   SKIP_SEED=1     send whatever the oracle already holds for PAYTO
 *   TIMEOUT_SEC     how long to wait for delivery (default 300)
 */
import { ethers } from "ethers";
import {
  TELEPORTER, L1_NAME, connect, contractAt, printBalances, isExecute,
  loadDeployment, saveDeployment, fujiTx, l1Tx, l1Addr,
} from "./lib/icmReputation";

const CLOUD = (process.env.CHAINPE_CLOUD_URL ?? "https://chainpe-cloud-production-1d71cb77.up.railway.app").replace(/\/+$/, "");
const DEMO_PAYTO = ethers.getAddress("0x" + ethers.id("chainpe-phase5-demo-provider").slice(26));
const MAX_LOG_RANGE = 2000;

interface PublicService { name: string; payTo: string; paidScore: number | null; paidReviews: number; payToShared: boolean }

async function pickScore(): Promise<{ payTo: string; score: number; reviews: number; label: string }> {
  if (process.env.MIRROR_FROM_MAINNET === "1") {
    const res = await fetch(`${CLOUD}/v1/public/services`);
    if (!res.ok) {
      throw new Error(
        `chainpe-cloud ${CLOUD}/v1/public/services answered HTTP ${res.status}. ` +
          (res.status === 404 ? "The deployed instance predates the public route; redeploy chainpe-cloud or drop MIRROR_FROM_MAINNET and pass SCORE/REVIEWS." : "")
      );
    }
    const { services } = (await res.json()) as { services: PublicService[] };
    const eligible = services.filter((s) => !s.payToShared && s.paidScore !== null && s.paidReviews > 0);
    const want = process.env.PAYTO?.toLowerCase();
    const s = want ? eligible.find((x) => x.payTo.toLowerCase() === want) : eligible[0];
    if (!s) throw new Error(want ? `No eligible mainnet score for ${process.env.PAYTO}` : "No service with a verified paid score on chainpe-cloud");
    return {
      payTo: ethers.getAddress(s.payTo), score: Math.round(s.paidScore!), reviews: s.paidReviews,
      label: `mirrored from mainnet by the attester (chainpe-cloud: "${s.name}")`,
    };
  }
  const score = Number(process.env.SCORE ?? 80);
  const reviews = Number(process.env.REVIEWS ?? 5);
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error("SCORE must be an integer 0-100");
  return { payTo: ethers.getAddress(process.env.PAYTO ?? DEMO_PAYTO), score, reviews, label: "demo score set by the attester on Fuji" };
}

/** Finds the L1 tx that delivered `messageID` (Teleporter logs index messageID as topic 1). */
async function findDelivery(provider: ethers.Provider, messageID: string, fromBlock: number) {
  const latest = await provider.getBlockNumber();
  for (let start = fromBlock; start <= latest; start += MAX_LOG_RANGE) {
    const logs = await provider.getLogs({ address: TELEPORTER, fromBlock: start, toBlock: Math.min(latest, start + MAX_LOG_RANGE - 1), topics: [null, messageID] });
    if (logs.length) return logs[0];
  }
  return null;
}

async function main() {
  const c = await connect();
  const d = loadDeployment();
  if (!d.l1.trustedSenderTx) console.log("  ! deployments file has no trustedSenderTx: run configure-icm-reputation.ts first");

  const oracle = await contractAt("ChainPeReputationOracle", d.fuji.reputationOracle, c.fuji);
  const sender = await contractAt("ChainPeICMSender", d.fuji.chainPeICMSender, c.fuji);
  const mirror = await contractAt("ChainPeReputationMirror", d.l1.chainPeReputationMirror, c.l1);
  const skipSeed = process.env.SKIP_SEED === "1";
  const pick = skipSeed
    ? { payTo: ethers.getAddress(process.env.PAYTO ?? DEMO_PAYTO), score: -1, reviews: -1, label: "existing oracle record" }
    : await pickScore();

  console.log(`\nPhase 5 send: Fuji C-Chain -> ${L1_NAME}`);
  await printBalances(c);
  const isAttester: boolean = await oracle.isAttester(c.fuji.address);
  console.log(`  Oracle:   ${d.fuji.reputationOracle} (wallet is attester: ${isAttester})`);
  console.log(`  Sender:   ${d.fuji.chainPeICMSender}`);
  console.log(`  Mirror:   ${d.l1.chainPeReputationMirror} on ${L1_NAME}`);
  console.log(`  payTo:    ${pick.payTo}`);
  if (!skipSeed) console.log(`  Score:    ${pick.score} from ${pick.reviews} paid reviews (${pick.label})`);
  const before = await mirror.getReputation(pick.payTo);
  console.log(`  Mirror now: score ${before.paidScore}, reviews ${before.paidReviews}, sourceTimestamp ${before.sourceTimestamp}`);

  if (!skipSeed && !isAttester) throw new Error("Wallet is not an oracle attester; cannot seed. Use SKIP_SEED=1 or the attester key.");
  if (!isExecute()) return console.log("\n  Dry run only. Re-run with EXECUTE=1 to seed + send (2 Fuji txs, 0 L1 txs).\n");

  let seedTx: string | null = null;
  if (!skipSeed) {
    const tx = await oracle.setScore(pick.payTo, pick.score, pick.reviews);
    await tx.wait();
    seedTx = tx.hash as string;
    console.log(`\n  1. setScore           ${fujiTx(tx.hash)}`);
  }
  const [score, reviews, updatedAt] = await oracle.getEntry(pick.payTo);
  if (updatedAt === 0n) throw new Error(`Oracle has no record for ${pick.payTo}`);

  const l1StartBlock = await c.l1.provider!.getBlockNumber();
  const tx = await sender.sendReputation(d.l1.blockchainID, d.l1.chainPeReputationMirror, pick.payTo);
  const receipt = await tx.wait();
  const sentAt = Date.now();
  const ev = receipt.logs.map((l: ethers.Log) => { try { return sender.interface.parseLog(l); } catch { return null; } }).find((p: any) => p?.name === "ReputationSent");
  const messageID: string = ev!.args.messageID;
  const sendBlock = await c.fuji.provider!.getBlock(receipt.blockNumber);
  console.log(`  2. sendReputation     ${fujiTx(tx.hash)}`);
  console.log(`     Teleporter messageID ${messageID}`);
  console.log(`     sent score ${score} / ${reviews} reviews / oracle updatedAt ${updatedAt}`);

  const timeoutMs = Number(process.env.TIMEOUT_SEC ?? 300) * 1000;
  process.stdout.write(`  3. waiting for ${L1_NAME} mirror `);
  let r = await mirror.getReputation(pick.payTo);
  while (r.sourceTimestamp < updatedAt) {
    if (Date.now() - sentAt > timeoutMs) {
      console.log(`\n\n  ✗ Not delivered after ${timeoutMs / 1000}s. messageID ${messageID}`);
      const delivered = await findDelivery(c.l1.provider!, messageID, l1StartBlock);
      console.log(delivered ? `    Teleporter on ${L1_NAME} DID see it: ${l1Tx(delivered.transactionHash)} (execution may have failed)` : `    Teleporter on ${L1_NAME} has no log for it: the relayer has not delivered. Check relayer logs.`);
      process.exitCode = 1;
      return;
    }
    await new Promise((res) => setTimeout(res, 2000));
    process.stdout.write(".");
    r = await mirror.getReputation(pick.payTo);
  }
  const elapsed = ((Date.now() - sentAt) / 1000).toFixed(1);
  const delivery = await findDelivery(c.l1.provider!, messageID, l1StartBlock);
  const deliveryBlock = delivery ? await c.l1.provider!.getBlock(delivery.blockNumber) : null;
  const blockDelta = deliveryBlock && sendBlock ? deliveryBlock.timestamp - sendBlock.timestamp : null;

  console.log(` arrived.\n`);
  console.log(`  ${L1_NAME} mirror: score ${r.paidScore}, paid reviews ${r.paidReviews}, agentId ${r.agentId}, sourceTimestamp ${r.sourceTimestamp}, receivedAt ${r.receivedAt}`);
  console.log(`  Fuji send tx:      ${fujiTx(tx.hash)}`);
  console.log(`  ${L1_NAME} delivery tx: ${delivery ? l1Tx(delivery.transactionHash) : "(not found in logs)"}`);
  console.log(`  Mirror contract:   ${l1Addr(d.l1.chainPeReputationMirror)}`);
  console.log(`  Elapsed: ${elapsed}s after the send confirmed${blockDelta !== null ? ` (block timestamps: ${blockDelta}s)` : ""}\n`);

  d.demoSends = [...(d.demoSends ?? []), {
    payTo: pick.payTo, score: Number(score), paidReviews: Number(reviews), source: pick.label,
    seedTx, sendTx: tx.hash, messageID, deliveryTx: delivery?.transactionHash ?? null,
    elapsedSec: Number(elapsed), blockTimestampDeltaSec: blockDelta, at: new Date().toISOString(),
  }];
  saveDeployment(d);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
