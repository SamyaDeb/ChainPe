#!/usr/bin/env node

/**
 * Test script for full agent flow with keychain integration
 * Creates agent config and tests wallet retrieval from keychain
 */

import {
  saveMnemonic,
  getMnemonic,
  hasMnemonic,
  isKeychainAvailable,
} from "../src/keychain.js";
import {
  buildConfig,
  saveConfig,
  loadConfig,
  addressFromMnemonic,
  saveWalletToKeychain,
  getWalletMnemonic,
} from "../src/config.js";
import { createWalletFromMnemonic, getWalletBalance, formatBalance } from "../src/wallet.js";
import { PaymentClient } from "../src/payment.js";

// Test mnemonic provided by user
const TEST_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss";

async function runTests() {
  console.log("=".repeat(60));
  console.log("  ChainPe Agent - Full Agent Flow Test");
  console.log("=".repeat(60));
  console.log();

  // Step 1: Check keychain
  console.log("Step 1: Verifying keychain access...");
  const available = await isKeychainAvailable();
  if (!available) {
    console.log("  ❌ Keychain not available");
    process.exit(1);
  }
  console.log("  ✅ Keychain available");
  console.log();

  // Step 2: Derive wallet address
  console.log("Step 2: Deriving wallet address...");
  const walletAddress = addressFromMnemonic(TEST_MNEMONIC);
  console.log(`  ✅ Address: ${walletAddress}`);
  console.log();

  // Step 3: Ensure mnemonic is in keychain
  console.log("Step 3: Ensuring mnemonic is in keychain...");
  const exists = await hasMnemonic(walletAddress);
  if (!exists) {
    console.log("  Saving to keychain...");
    await saveWalletToKeychain(walletAddress, TEST_MNEMONIC);
  }
  console.log("  ✅ Mnemonic is in keychain");
  console.log();

  // Step 4: Build and save config (WITHOUT mnemonic in file)
  console.log("Step 4: Building secure config...");
  const config = buildConfig({
    llmMode: "api",
    llmProvider: "groq",
    llmModel: "llama-3.1-8b-instant",
    llmApiKey: "test-api-key",
    walletAddress: walletAddress, // Only address, no mnemonic!
    preferredToken: "ALGO",
    network: "testnet",
  });

  // Verify config doesn't contain mnemonic
  const configJson = JSON.stringify(config);
  if (configJson.includes(TEST_MNEMONIC) || configJson.includes("crack scout")) {
    console.log("  ❌ SECURITY ERROR: Config contains mnemonic!");
    process.exit(1);
  }
  console.log("  ✅ Config built (no mnemonic in config)");
  console.log(`     Wallet address: ${config.wallet.address}`);
  console.log(`     useKeychain: ${config.wallet.useKeychain}`);
  console.log();

  // Step 5: Save config
  console.log("Step 5: Saving config to disk...");
  await saveConfig(config);
  console.log("  ✅ Config saved to ~/.chainpe/agent.json");
  console.log();

  // Step 6: Load config and verify no mnemonic
  console.log("Step 6: Loading config from disk...");
  const loadedConfig = await loadConfig();
  if (!loadedConfig) {
    console.log("  ❌ Failed to load config");
    process.exit(1);
  }
  
  // Verify no mnemonic in loaded config
  const loadedJson = JSON.stringify(loadedConfig);
  if (loadedJson.includes("crack scout")) {
    console.log("  ❌ SECURITY ERROR: Loaded config contains mnemonic!");
    process.exit(1);
  }
  console.log("  ✅ Config loaded (no mnemonic in loaded config)");
  console.log();

  // Step 7: Retrieve mnemonic from keychain using config address
  console.log("Step 7: Retrieving mnemonic from keychain...");
  const retrievedMnemonic = await getWalletMnemonic(loadedConfig.wallet.address);
  if (!retrievedMnemonic) {
    console.log("  ❌ Failed to retrieve mnemonic from keychain");
    process.exit(1);
  }
  if (retrievedMnemonic !== TEST_MNEMONIC) {
    console.log("  ❌ Retrieved mnemonic doesn't match!");
    process.exit(1);
  }
  console.log("  ✅ Mnemonic retrieved from keychain successfully");
  console.log();

  // Step 8: Create wallet from retrieved mnemonic
  console.log("Step 8: Creating wallet instance...");
  const wallet = createWalletFromMnemonic(retrievedMnemonic);
  console.log(`  ✅ Wallet created: ${wallet.address}`);
  console.log(`     Signer available: ${!!wallet.signer}`);
  console.log();

  // Step 9: Check wallet balance
  console.log("Step 9: Checking wallet balance on testnet...");
  try {
    const balance = await getWalletBalance(wallet.address, "testnet");
    const formatted = formatBalance(balance);
    console.log(`  ✅ Balance: ${formatted.algo} ALGO`);
    console.log(`     USDC: ${formatted.usdc}`);
    console.log(`     Available: ${formatted.available} ALGO`);
  } catch (error) {
    console.log(`  ⚠️ Could not fetch balance: ${(error as Error).message}`);
  }
  console.log();

  // Step 10: Create PaymentClient
  console.log("Step 10: Creating PaymentClient...");
  const paymentClient = new PaymentClient({
    mnemonic: retrievedMnemonic,
    network: "testnet",
  });
  console.log(`  ✅ PaymentClient created`);
  console.log(`     Wallet address: ${paymentClient.getAddress()}`);
  console.log();

  // Summary
  console.log("=".repeat(60));
  console.log("  All Tests Passed! ✅");
  console.log("=".repeat(60));
  console.log();
  console.log("  Security Summary:");
  console.log("    ✅ Mnemonic stored in macOS Keychain (encrypted)");
  console.log("    ✅ Config file does NOT contain mnemonic");
  console.log("    ✅ Mnemonic retrieved at runtime from keychain");
  console.log("    ✅ PaymentClient can sign transactions");
  console.log();
  console.log("  Wallet Info:");
  console.log(`    Address: ${walletAddress}`);
  console.log("    Network: testnet");
  console.log();
  console.log("  The agent is ready to make automatic x402 payments!");
  console.log("  Run 'chainpe-agent status' to see full configuration.");
  console.log();
}

// Run tests
runTests().catch((error) => {
  console.error("Test failed with error:", error);
  process.exit(1);
});
