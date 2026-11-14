/**
 * Pushes each service's payment-verified score from chainpe-cloud to the ChainPeReputationOracle.
 *
 *   Dry run (default): prints what would be written.
 *     npx hardhat run scripts/publish-scores.ts --network avalanche
 *   Write:
 *     EXECUTE=1 npx hardhat run scripts/publish-scores.ts --network avalanche
 *
 * DEPLOYER_PRIVATE_KEY must be an oracle ATTESTER (the ATTESTER_ADDRESS from upgrade-policyvault.ts), not the owner.
 * CHAINPE_CLOUD_URL defaults to the hosted chainpe-cloud. Services with no verified paid review are skipped.
 * Run it on a schedule (cron) shorter than the oracle's maxAge.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const CLOUD = (process.env.CHAINPE_CLOUD_URL ?? "https://chainpe-cloud-production-1d71cb77.up.railway.app").replace(/\/+$/, "");

async function main() {
  const oracleAddr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}-reputation-oracle.json`), "utf8")).oracle;
  const res = await fetch(`${CLOUD}/v1/public/services`);
  if (!res.ok) throw new Error(`chainpe-cloud answered HTTP ${res.status}`);
  const { services } = (await res.json()) as { services: { name: string; payTo: string; paidScore: number | null; paidReviews: number; payToShared: boolean }[] };

  // One entry per payTo; a payTo shared by several services belongs to the earliest (the others are flagged).
  const rows = services.filter((s) => !s.payToShared && s.paidScore !== null && s.paidReviews > 0);
  for (const s of rows) console.log(`${s.name.padEnd(16)} ${s.payTo}  score ${s.paidScore}  paid reviews ${s.paidReviews}`);
  if (rows.length === 0) return console.log("Nothing to publish.");
  if (process.env.EXECUTE !== "1") return console.log("Dry run only. Re-run with EXECUTE=1 to write.");

  const [signer] = await ethers.getSigners();
  const oracle = (await ethers.getContractAt("ChainPeReputationOracle", oracleAddr, signer)) as any;
  if (!(await oracle.isAttester(signer.address))) throw new Error(`${signer.address} is not an attester on ${oracleAddr}`);
  const tx = await oracle.setScores(rows.map((s) => s.payTo), rows.map((s) => Math.round(s.paidScore!)), rows.map((s) => s.paidReviews));
  console.log(`setScores tx ${tx.hash}`);
  await tx.wait();
}

main().catch((e) => { console.error(e); process.exit(1); });
