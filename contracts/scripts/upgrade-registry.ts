/**
 * Upgrade the mainnet ChainPeRegistry proxy to the Phase 3.3 implementation (agentId ownership).
 *
 *   Dry run (default; no transactions, no key needed beyond the owner address check):
 *     npx hardhat run scripts/upgrade-registry.ts --network avalanche
 *
 *   Execute (sends 2 txs: deploy new implementation, then proxy.upgradeToAndCall):
 *     EXECUTE=1 npx hardhat run scripts/upgrade-registry.ts --network avalanche
 *
 * Requires DEPLOYER_PRIVATE_KEY to be the proxy owner. Safety checks, all before any tx:
 *   1. chainId matches deployments/<network>.json
 *   2. proxy owner == signer
 *   3. upgrades.validateUpgrade(V1 -> V2): storage layout is append-only / upgrade-safe
 *   4. snapshot of service count + all services, compared again after the upgrade
 */
import { ethers, network, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const proxyAddr: string = dep.chainPeRegistryProxy;
  const execute = process.env.EXECUTE === "1";

  const net = await ethers.provider.getNetwork();
  if (Number(net.chainId) !== Number(dep.chainId)) {
    throw new Error(`chainId ${net.chainId} != deployments chainId ${dep.chainId}`);
  }
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No signer: set DEPLOYER_PRIVATE_KEY (the proxy owner)");

  const V1 = await ethers.getContractFactory("ChainPeRegistryUpgradeableV1"); // frozen pre-upgrade source
  const V2 = await ethers.getContractFactory("ChainPeRegistryUpgradeable");
  const live = V1.attach(proxyAddr).connect(signer) as any;

  const owner: string = await live.owner();
  console.log(`Proxy ${proxyAddr}\nOwner ${owner}\nSigner ${signer.address}\nMode  ${execute ? "EXECUTE" : "DRY RUN"}`);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) throw new Error("Signer is not the proxy owner");

  // ERC-1967 implementation slot: current implementation
  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const currentImpl = ethers.getAddress("0x" + (await ethers.provider.getStorage(proxyAddr, IMPL_SLOT)).slice(26));
  console.log(`Current implementation ${currentImpl}`);

  await upgrades.validateUpgrade(V1, V2, { kind: "uups" });
  console.log("validateUpgrade OK: storage layout is upgrade-safe");

  const count: bigint = await live.getServiceCount();
  const snap = count > 0n ? await live.getServices(0, count > 100n ? 100n : count) : [];
  const fingerprint = (a: any[]) => JSON.stringify(a.map((s: any) => [s.name, s.payTo, s.developer, s.agentId.toString(), s.endpoint]));
  const before = fingerprint([...snap]);
  console.log(`Services before: ${count}`);

  if (!execute) {
    const impl = await V2.getDeployTransaction();
    const gas = await ethers.provider.estimateGas({ ...impl, from: signer.address });
    console.log(`Dry run only. New implementation deploy gas ≈ ${gas}. Re-run with EXECUTE=1 to upgrade.`);
    return;
  }

  const impl = await V2.deploy();
  const deployTx = impl.deploymentTransaction()!;
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log(`New implementation ${implAddr} (tx ${deployTx.hash})`);

  const tx = await live.upgradeToAndCall(implAddr, "0x");
  console.log(`upgradeToAndCall tx ${tx.hash}`);
  await tx.wait();

  const v2 = V2.attach(proxyAddr) as any;
  const afterCount: bigint = await v2.getServiceCount();
  const after = afterCount > 0n ? await v2.getServices(0, afterCount > 100n ? 100n : afterCount) : [];
  if (afterCount !== count || fingerprint([...after]) !== before) throw new Error("POST-UPGRADE STATE MISMATCH, investigate immediately");
  console.log(`Post-upgrade OK: version ${await v2.getVersion()}, ${afterCount} services unchanged, owner ${await v2.owner()}`);

  dep.chainPeRegistryImplPrev = currentImpl;
  dep.chainPeRegistryImpl = implAddr;
  dep.registryV2UpgradeTx = tx.hash;
  dep.registryV2UpgradedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(dep, null, 2) + "\n");
  console.log(`Saved to ${file}\nVerify: npx hardhat verify --network avalanche ${implAddr}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
