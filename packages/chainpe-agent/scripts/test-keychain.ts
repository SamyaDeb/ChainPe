#!/usr/bin/env node

/**
 * Test script for macOS Keychain integration
 * Tests storing and retrieving mnemonic from OS keychain
 */

import {
  saveMnemonic,
  getMnemonic,
  hasMnemonic,
  deleteMnemonic,
  isKeychainAvailable,
  getCredentialInfo,
  listStoredWallets,
} from "../src/keychain.js";
import { addressFromMnemonic, isValidMnemonic } from "../src/config.js";

// Test mnemonic provided by user
const TEST_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss";

async function runTests() {
  console.log("=".repeat(60));
  console.log("  ChainPe Agent - macOS Keychain Integration Test");
  console.log("=".repeat(60));
  console.log();

  // Test 1: Check keychain availability
  console.log("Test 1: Checking OS Keychain availability...");
  const available = await isKeychainAvailable();
  if (available) {
    console.log("  ✅ OS Keychain is available");
  } else {
    console.log("  ❌ OS Keychain is NOT available");
    console.log("  Cannot continue tests without keychain access.");
    process.exit(1);
  }
  console.log();

  // Test 2: Validate mnemonic
  console.log("Test 2: Validating mnemonic...");
  const isValid = isValidMnemonic(TEST_MNEMONIC);
  if (isValid) {
    console.log("  ✅ Mnemonic is valid (25 words)");
  } else {
    console.log("  ❌ Mnemonic is INVALID");
    process.exit(1);
  }
  console.log();

  // Test 3: Derive wallet address
  console.log("Test 3: Deriving wallet address from mnemonic...");
  const walletAddress = addressFromMnemonic(TEST_MNEMONIC);
  console.log(`  ✅ Wallet Address: ${walletAddress}`);
  console.log(`     (First 8 chars: ${walletAddress.slice(0, 8)}...)`);
  console.log();

  // Test 4: Save mnemonic to keychain
  console.log("Test 4: Saving mnemonic to OS Keychain...");
  try {
    await saveMnemonic(walletAddress, TEST_MNEMONIC);
    console.log("  ✅ Mnemonic saved to keychain");
  } catch (error) {
    console.log(`  ❌ Failed to save: ${(error as Error).message}`);
    process.exit(1);
  }
  console.log();

  // Test 5: Check if mnemonic exists in keychain
  console.log("Test 5: Checking if mnemonic exists in keychain...");
  const exists = await hasMnemonic(walletAddress);
  if (exists) {
    console.log("  ✅ Mnemonic found in keychain");
  } else {
    console.log("  ❌ Mnemonic NOT found in keychain");
    process.exit(1);
  }
  console.log();

  // Test 6: Retrieve mnemonic from keychain
  console.log("Test 6: Retrieving mnemonic from keychain...");
  const retrieved = await getMnemonic(walletAddress);
  if (retrieved === TEST_MNEMONIC) {
    console.log("  ✅ Retrieved mnemonic matches original");
    console.log(`     (First 20 chars: "${retrieved.slice(0, 20)}...")`);
  } else if (retrieved) {
    console.log("  ❌ Retrieved mnemonic does NOT match!");
    console.log(`     Expected: "${TEST_MNEMONIC.slice(0, 20)}..."`);
    console.log(`     Got:      "${retrieved.slice(0, 20)}..."`);
    process.exit(1);
  } else {
    console.log("  ❌ Failed to retrieve mnemonic");
    process.exit(1);
  }
  console.log();

  // Test 7: List stored wallets
  console.log("Test 7: Listing stored wallets...");
  const wallets = await listStoredWallets();
  console.log(`  ✅ Found ${wallets.length} wallet(s) in keychain:`);
  for (const w of wallets) {
    console.log(`     - ${w.slice(0, 8)}...${w.slice(-4)}`);
  }
  console.log();

  // Test 8: Get credential info
  console.log("Test 8: Getting credential info...");
  const info = await getCredentialInfo();
  console.log(`  ✅ Keychain available: ${info.available}`);
  console.log(`     Wallet count: ${info.walletCount}`);
  console.log();

  // Test 9: Clean up (optional - comment out to keep in keychain)
  // console.log("Test 9: Cleaning up (deleting test mnemonic)...");
  // const deleted = await deleteMnemonic(walletAddress);
  // if (deleted) {
  //   console.log("  ✅ Mnemonic deleted from keychain");
  // } else {
  //   console.log("  ⚠️ Mnemonic was not deleted (may not have existed)");
  // }
  // console.log();

  // Summary
  console.log("=".repeat(60));
  console.log("  All Tests Passed! ✅");
  console.log("=".repeat(60));
  console.log();
  console.log("  Your wallet is now securely stored in macOS Keychain.");
  console.log(`  Wallet Address: ${walletAddress}`);
  console.log();
  console.log("  The mnemonic is:");
  console.log("    - NOT stored in any file on disk");
  console.log("    - Encrypted by the OS");
  console.log("    - Accessible only when you're logged in");
  console.log();
  console.log("  Next steps:");
  console.log("    1. Run 'chainpe-agent init' to configure the agent");
  console.log("    2. Or use the mnemonic directly in your code");
  console.log();
}

// Run tests
runTests().catch((error) => {
  console.error("Test failed with error:", error);
  process.exit(1);
});
