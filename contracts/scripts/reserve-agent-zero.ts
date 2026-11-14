/**
 * Reserves ERC-8004 agent #0 on mainnet before any real agent is minted.
 *
 * The IdentityRegistry numbers agents from 0, but ChainPeRegistry and every ChainPe reader treat agentId 0 as
 * "no agent linked". So agent #0 can never be protected by the registry's ownership check: anyone may register a
 * service with agentId 0. Minting #0 to the ChainPe deployer first makes sure no real provider ever gets that id.
 *
 *   Dry run (default; reads only):
 *     npx hardhat run scripts/reserve-agent-zero.ts --network avalanche
 *   Mint it (one tx, ≈ 0.005 AVAX):
 *     EXECUTE=1 npx hardhat run scripts/reserve-agent-zero.ts --network avalanche
 *
 * Run it BEFORE registering the demo services (docs/PHASE3-RUNBOOK.md).
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const IDENTITY_ABI = [
  "function ownerOf(uint256) view returns (address)",
  "function register(string agentURI) returns (uint256)",
];

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}-erc8004.json`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const [signer] = await ethers.getSigners();
  const identity = new ethers.Contract(dep.identityRegistry, IDENTITY_ABI, signer);
  console.log(`IdentityRegistry ${dep.identityRegistry} on ${network.name}\nSigner ${signer.address}`);

  const owner0: string | null = await identity.ownerOf(0).catch(() => null);
  if (owner0) {
    console.log(`Agent #0 already exists, owned by ${owner0}. Nothing to do.`);
    if (owner0.toLowerCase() !== signer.address.toLowerCase()) {
      console.log("Note: #0 belongs to someone else. ChainPe treats agentId 0 as 'unlinked', so it cannot be hijacked, but it also can't be used.");
    }
    return;
  }

  const uri = "data:application/json,%7B%22name%22%3A%22ChainPe%20reserved%20%230%22%7D";
  const gas = await identity.register.estimateGas(uri);
  if (process.env.EXECUTE !== "1") {
    console.log(`Dry run: would mint agent #0 to ${signer.address} (gas ≈ ${gas}). Re-run with EXECUTE=1.`);
    return;
  }
  const tx = await identity.register(uri);
  const receipt = await tx.wait();
  console.log(`Minted agent #0 to ${await identity.ownerOf(0)} in tx ${receipt!.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
