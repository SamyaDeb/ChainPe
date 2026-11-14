/**
 * Upgrade the mainnet PolicyVault proxy to v2 (reputation gate, epochs, totalSpent kept) and wire the oracle.
 *
 *   Dry run (default; sends nothing):
 *     npx hardhat run scripts/upgrade-policyvault.ts --network avalanche
 *
 *   Execute (sends up to 4 txs: deploy oracle, deploy new vault impl, upgradeToAndCall, setReputationOracle):
 *     ATTESTER_ADDRESS=0x... EXECUTE=1 npx hardhat run scripts/upgrade-policyvault.ts --network avalanche
 *
 * DEPLOYER_PRIVATE_KEY must be the vault proxy owner. ATTESTER_ADDRESS is the address (a dedicated hot key, NOT the
 * owner) that will push scores to the oracle with scripts/publish-scores.ts.
 *
 * WARNING: SPEND_TYPEHASH gained an `epoch` field. Every spend authorization signed before this upgrade stops
 * working, and clients must use the updated @chainpeavax/sdk (PolicyVaultClient) to sign. Do this when no
 * authorizations are in flight.
 */
import { ethers, network, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const vaultFile = path.join(__dirname, "..", "deployments", `${network.name}-policyvault.json`);
  const dep = JSON.parse(fs.readFileSync(vaultFile, "utf8"));
  const oracleFile = path.join(__dirname, "..", "deployments", `${network.name}-reputation-oracle.json`);
  const proxyAddr: string = dep.policyVaultProxy;
  const execute = process.env.EXECUTE === "1";

  const net = await ethers.provider.getNetwork();
  if (Number(net.chainId) !== Number(dep.chainId)) throw new Error(`chainId ${net.chainId} != deployments chainId ${dep.chainId}`);
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No signer: set DEPLOYER_PRIVATE_KEY (the vault owner)");

  const V1 = await ethers.getContractFactory("PolicyVaultUpgradeableV1"); // frozen pre-upgrade source
  const V2 = await ethers.getContractFactory("PolicyVaultUpgradeable");
  const live = V1.attach(proxyAddr).connect(signer) as any;
  const owner: string = await live.owner();
  console.log(`Vault ${proxyAddr}\nOwner ${owner}\nSigner ${signer.address}\nMode  ${execute ? "EXECUTE" : "DRY RUN"}`);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) throw new Error("Signer is not the vault owner");

  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const currentImpl = ethers.getAddress("0x" + (await ethers.provider.getStorage(proxyAddr, IMPL_SLOT)).slice(26));
  console.log(`Current implementation ${currentImpl}`);

  await upgrades.validateUpgrade(V1, V2, { kind: "uups" });
  console.log("validateUpgrade OK: storage layout is upgrade-safe (append-only)");

  const before = {
    token: await live.token(),
    domain: await live.domainSeparator(),
    paused: await live.paused(),
  };

  const attester = process.env.ATTESTER_ADDRESS;
  if (!attester || !ethers.isAddress(attester)) throw new Error("Set ATTESTER_ADDRESS to the address that will publish scores");
  if (attester.toLowerCase() === owner.toLowerCase()) console.warn("WARNING: attester == owner. Use a separate hot key.");

  if (!execute) {
    const g1 = await ethers.provider.estimateGas({ ...(await V2.getDeployTransaction()), from: signer.address });
    const O = await ethers.getContractFactory("ChainPeReputationOracle");
    const g2 = await ethers.provider.estimateGas({ ...(await O.getDeployTransaction(owner, attester)), from: signer.address });
    console.log(`Dry run only. Gas: vault impl ≈ ${g1}, oracle ≈ ${g2}. Re-run with EXECUTE=1 to apply.`);
    return;
  }

  // 1. Oracle (reuse one from a previous partial run).
  let oracleAddr: string;
  if (fs.existsSync(oracleFile)) {
    oracleAddr = JSON.parse(fs.readFileSync(oracleFile, "utf8")).oracle;
    // A saved address is only trusted if it is really our oracle on this chain, with the expected owner and attester.
    if ((await ethers.provider.getCode(oracleAddr)) === "0x") throw new Error(`Saved oracle ${oracleAddr} has no code on ${network.name}. Delete ${oracleFile} and re-run.`);
    const saved = await ethers.getContractAt("ChainPeReputationOracle", oracleAddr);
    const [savedOwner, attesterOk] = await Promise.all([saved.owner(), saved.isAttester(attester)]);
    if (savedOwner.toLowerCase() !== owner.toLowerCase() || !attesterOk) {
      throw new Error(`Saved oracle ${oracleAddr} has owner ${savedOwner} (attester ${attester} allowed: ${attesterOk}); expected owner ${owner} with that attester.`);
    }
    console.log(`Reusing oracle ${oracleAddr}`);
  } else {
    const O = await ethers.getContractFactory("ChainPeReputationOracle");
    const oracle = await O.deploy(owner, attester);
    await oracle.waitForDeployment();
    oracleAddr = await oracle.getAddress();
    fs.writeFileSync(oracleFile, JSON.stringify({ network: network.name, chainId: Number(net.chainId), oracle: oracleAddr, owner, attester, deployTx: oracle.deploymentTransaction()!.hash, deployedAt: new Date().toISOString() }, null, 2) + "\n");
    console.log(`Oracle ${oracleAddr} (tx ${oracle.deploymentTransaction()!.hash})`);
  }

  // 2. New vault implementation, then upgrade.
  const impl = await V2.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log(`New implementation ${implAddr} (tx ${impl.deploymentTransaction()!.hash})`);
  const up = await live.upgradeToAndCall(implAddr, "0x");
  console.log(`upgradeToAndCall tx ${up.hash}`);
  await up.wait();

  // 3. Point the vault at the oracle.
  const v2 = V2.attach(proxyAddr).connect(signer) as any;
  const set = await v2.setReputationOracle(oracleAddr);
  console.log(`setReputationOracle tx ${set.hash}`);
  await set.wait();

  if ((await v2.token()) !== before.token || (await v2.domainSeparator()) !== before.domain || (await v2.owner()) !== owner) {
    throw new Error("POST-UPGRADE STATE MISMATCH, investigate immediately");
  }
  console.log(`Post-upgrade OK: version ${await v2.getVersion()}, oracle ${await v2.reputationOracle()}`);

  dep.policyVaultImplPrev = currentImpl;
  dep.policyVaultImpl = implAddr;
  dep.reputationOracle = oracleAddr;
  dep.v2UpgradeTx = up.hash;
  dep.v2UpgradedAt = new Date().toISOString();
  fs.writeFileSync(vaultFile, JSON.stringify(dep, null, 2) + "\n");
  console.log(`Saved ${vaultFile}\nVerify: npx hardhat verify --network avalanche ${implAddr}\n        npx hardhat verify --network avalanche ${oracleAddr} ${owner} ${attester}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
