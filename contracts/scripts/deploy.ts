#!/usr/bin/env tsx
/**
 * Deploy ChainPeRegistry contract to Algorand testnet.
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="word1 word2 ... word25" tsx scripts/deploy.ts
 *
 * Outputs the deployed App ID, which should be saved for use by the SDK.
 */

import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

// ============================================================================
// Config
// ============================================================================

const NETWORK = process.env.NETWORK ?? "testnet";
const DEPLOYER_MNEMONIC = process.env.DEPLOYER_MNEMONIC;

if (!DEPLOYER_MNEMONIC) {
  console.error("ERROR: DEPLOYER_MNEMONIC environment variable is required.");
  console.error("  Set it to your 25-word Algorand mnemonic.");
  process.exit(1);
}

// ============================================================================
// Load compiled ARC-56 spec
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arc56Path = path.join(__dirname, "../src/out/ChainPeRegistry.arc56.json");

let appSpec: Record<string, unknown>;
try {
  const raw = await readFile(arc56Path, "utf-8");
  appSpec = JSON.parse(raw);
} catch {
  console.error(`ERROR: Could not read compiled ARC-56 spec at ${arc56Path}`);
  console.error("  Run 'npm run compile' first.");
  process.exit(1);
}

// ============================================================================
// Connect to network
// ============================================================================

let algorand: AlgorandClient;

if (NETWORK === "mainnet") {
  algorand = AlgorandClient.mainNet();
} else {
  algorand = AlgorandClient.testNet();
}

// Load deployer account from mnemonic
const deployer = algorand.account.fromMnemonic(DEPLOYER_MNEMONIC);
const deployerAddr = deployer.addr.toString();
console.log(`\nDeployer address: ${deployerAddr}`);

// Check deployer balance
const info = await algorand.client.algod.accountInformation(deployerAddr).do();
const balanceMicroAlgo = info.amount;
const balanceAlgo = Number(balanceMicroAlgo) / 1_000_000;
console.log(`Deployer balance: ${balanceAlgo.toFixed(6)} ALGO`);

if (Number(balanceMicroAlgo) < 2_000_000) {
  console.warn("\nWARNING: Low balance. You need at least 2 ALGO to deploy.");
  console.warn("  Get testnet ALGO at: https://bank.testnet.algorand.network/");
}

// ============================================================================
// Deploy contract via AppFactory
// ============================================================================

console.log(`\nDeploying ChainPeRegistry to ${NETWORK}...`);

const factory = algorand.client.getAppFactory({
  appSpec: appSpec as any,
  defaultSender: deployer.addr,
  defaultSigner: deployer.signer,
});

// Force fresh deployment using create() instead of idempotent deploy()
const FORCE_NEW = process.env.FORCE_NEW === "true";

let appId: bigint;
let appAddress: string;
let action: string;

if (FORCE_NEW) {
  console.log("FORCE_NEW=true: Creating fresh contract (not idempotent)...");
  const { appClient: newClient, result: createResult } = await factory.send.create({
    method: "createApplication",
    args: [],
  });
  appId = newClient.appId;
  appAddress = newClient.appAddress.toString();
  action = "created (fresh)";
} else {
  const { appClient, result } = await factory.deploy({
    createParams: {
      method: "createApplication",
      args: [],
    },
    onSchemaBreak: "fail",
    onUpdate: "update",
  });
  appId = appClient.appId;
  appAddress = appClient.appAddress.toString();
  action = result.operationPerformed;
}

console.log("\n========================================");
console.log("  ChainPeRegistry deployed successfully!");
console.log("========================================");
console.log(`  App ID:      ${appId}`);
console.log(`  App address: ${appAddress}`);
console.log(`  Network:     ${NETWORK}`);
console.log(`  Action:      ${action}`);
console.log("\n  Save this App ID for your chainpe config:");
console.log(`  CHAINPE_REGISTRY_APP_ID=${appId}`);
console.log();
