/**
 * Proof that the upgraded registry refuses agentId hijacking: sends a REAL mainnet transaction that tries to register
 * a service linked to an agent the sender does not own. It is expected to REVERT with NotAgentOwner(agentId); the
 * reverted tx on Snowtrace is the README proof. It costs AVAX gas only: the ownership check runs before the
 * 1 USDC registration fee is collected, so no USDC moves.
 *
 *   Dry run (default; simulates with eth_call, sends nothing):
 *     ATTACKER_PRIVATE_KEY=0x... npx hardhat run scripts/hijack-attempt.ts --network avalanche
 *
 *   Send it (mines a reverted tx):
 *     ATTACKER_PRIVATE_KEY=0x... EXECUTE=1 npx hardhat run scripts/hijack-attempt.ts --network avalanche
 *
 * ATTACKER_PRIVATE_KEY: any funded wallet that does NOT own the victim agent (needs ≈ 0.01 AVAX).
 * VICTIM_AGENT_ID: the ERC-8004 agent to try to hijack (default: the first live service that has an agentId).
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const IDENTITY_ABI = ["function ownerOf(uint256) view returns (address)"];
const REGISTRY_ABI = [
  "function getVersion() view returns (string)",
  "function getServiceCount() view returns (uint256)",
  "function getServices(uint256,uint256) view returns (tuple(string name,string description,string tags,string endpoint,string pricePerRequest,string paymentToken,string network,address payTo,address developer,uint256 agentId,uint64 createdAt,uint64 updatedAt,bool exists)[])",
  "function identityRegistry() view returns (address)",
  "function register(tuple(string name,string description,string tags,string endpoint,string pricePerRequest,string paymentToken,string network,address payTo,uint256 agentId) input) returns (bytes32)",
  "error NotAgentOwner(uint256 agentId)",
];

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), "utf8"));
  const key = process.env.ATTACKER_PRIVATE_KEY;
  if (!key) throw new Error("Set ATTACKER_PRIVATE_KEY (a funded wallet that does not own the victim agent)");
  const attacker = new ethers.Wallet(key, ethers.provider);
  const registry = new ethers.Contract(dep.chainPeRegistryProxy, REGISTRY_ABI, attacker);

  const version: string = await registry.getVersion().catch(() => "1 (not upgraded: no getVersion)");
  console.log(`Registry ${dep.chainPeRegistryProxy}  version ${version}\nAttacker ${attacker.address}`);
  if (version !== "2.0.0") throw new Error("The registry is not upgraded yet. Run scripts/upgrade-registry.ts first, otherwise this would SUCCEED and register a hijacked service.");

  let victim = process.env.VICTIM_AGENT_ID ? BigInt(process.env.VICTIM_AGENT_ID) : 0n;
  if (victim === 0n) {
    const count: bigint = await registry.getServiceCount();
    const page = count > 0n ? await registry.getServices(0, count > 100n ? 100n : count) : [];
    victim = (page.find((s: { agentId: bigint }) => s.agentId > 0n)?.agentId as bigint | undefined) ?? 0n;
  }
  if (victim === 0n) throw new Error("No victim agent found. Set VICTIM_AGENT_ID to a registered ERC-8004 agent id (> 0).");

  const identity = new ethers.Contract(await registry.identityRegistry(), IDENTITY_ABI, ethers.provider);
  const owner: string = await identity.ownerOf(victim);
  console.log(`Victim agent #${victim}, owned by ${owner}`);
  if (owner.toLowerCase() === attacker.address.toLowerCase()) throw new Error("The attacker owns that agent: pick another ATTACKER_PRIVATE_KEY or VICTIM_AGENT_ID.");

  const input = {
    name: `hijack-attempt-${Date.now()}`, description: "agentId hijack attempt (expected to revert)", tags: "test",
    endpoint: "https://example.invalid", pricePerRequest: "0.01", paymentToken: "USDC", network: "avalanche",
    payTo: attacker.address, agentId: victim,
  };

  try {
    await registry.register.staticCall(input);
    throw new Error("UNEXPECTED: the simulation SUCCEEDED. The registry does not enforce agentId ownership.");
  } catch (e) {
    const err = e as { revert?: { name: string }; message: string };
    if (err.revert?.name !== "NotAgentOwner") throw e;
    console.log(`Simulation reverts with NotAgentOwner(${victim}) as expected.`);
  }

  if (process.env.EXECUTE !== "1") return console.log("Dry run only. Re-run with EXECUTE=1 to mine the reverted tx.");

  // A fixed gasLimit skips gas estimation (which would refuse to send a tx that is known to revert).
  const tx = await registry.register(input, { gasLimit: 600_000n });
  console.log(`Sent ${tx.hash}`);
  const receipt = await ethers.provider.waitForTransaction(tx.hash);
  if (!receipt) throw new Error("no receipt");
  console.log(`status: ${receipt.status === 0 ? "0 (REVERTED, as expected)" : "1 (SUCCEEDED, BAD!)"}  block ${receipt.blockNumber}  gas used ${receipt.gasUsed}`);
  if (receipt.status !== 0) throw new Error("The hijack succeeded on-chain. Pause the registry and investigate.");

  // Decode the revert from the mined block.
  try {
    await ethers.provider.call({ to: tx.to!, from: attacker.address, data: tx.data, blockTag: receipt.blockNumber - 1 });
  } catch (e) {
    console.log(`revert: ${(e as { revert?: { name: string; args: unknown[] } }).revert?.name}(${(e as { revert?: { args: unknown[] } }).revert?.args?.join(", ")})`);
  }
  console.log(`\nSnowtrace: https://snowtrace.io/tx/${tx.hash}   (Status: Fail, "NotAgentOwner")\nSave this hash for the README.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
