/**
 * Secure Credential Storage using OS Keychain
 * 
 * This module provides secure storage for the agent wallet mnemonic using
 * the operating system's native credential manager:
 * - macOS: Keychain Access
 * - Linux: Secret Service API (GNOME Keyring, KWallet)
 * - Windows: Credential Manager
 * 
 * The mnemonic is never stored in plaintext on disk.
 * It's encrypted by the OS and tied to the user's login credentials.
 */

import keytar from "keytar";

// ============================================================================
// Constants
// ============================================================================

/**
 * Service name used for keychain entries
 * All ChainPe agent credentials are stored under this service
 */
const SERVICE_NAME = "chainpe-agent";

/**
 * Account prefix for wallet mnemonics
 * Format: "wallet-{address}"
 */
const WALLET_PREFIX = "wallet";

// ============================================================================
// Mnemonic Storage
// ============================================================================

/**
 * Stores a wallet mnemonic securely in the OS keychain
 * 
 * @param walletAddress - The Algorand wallet address (used as unique identifier)
 * @param mnemonic - The 25-word Algorand mnemonic to store
 * @throws Error if keychain access is denied or unavailable
 */
export async function saveMnemonic(
  walletAddress: string,
  mnemonic: string
): Promise<void> {
  const account = `${WALLET_PREFIX}-${walletAddress}`;
  await keytar.setPassword(SERVICE_NAME, account, mnemonic);
}

/**
 * Retrieves a wallet mnemonic from the OS keychain
 * 
 * @param walletAddress - The Algorand wallet address
 * @returns The mnemonic if found, null otherwise
 * @throws Error if keychain access is denied
 */
export async function getMnemonic(
  walletAddress: string
): Promise<string | null> {
  const account = `${WALLET_PREFIX}-${walletAddress}`;
  return await keytar.getPassword(SERVICE_NAME, account);
}

/**
 * Removes a wallet mnemonic from the OS keychain
 * 
 * @param walletAddress - The Algorand wallet address
 * @returns true if the entry was deleted, false if it didn't exist
 */
export async function deleteMnemonic(
  walletAddress: string
): Promise<boolean> {
  const account = `${WALLET_PREFIX}-${walletAddress}`;
  return await keytar.deletePassword(SERVICE_NAME, account);
}

/**
 * Checks if a wallet mnemonic exists in the keychain
 * 
 * @param walletAddress - The Algorand wallet address
 * @returns true if the mnemonic is stored
 */
export async function hasMnemonic(
  walletAddress: string
): Promise<boolean> {
  const mnemonic = await getMnemonic(walletAddress);
  return mnemonic !== null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Lists all wallet addresses that have stored mnemonics
 * 
 * @returns Array of wallet addresses with stored credentials
 */
export async function listStoredWallets(): Promise<string[]> {
  const credentials = await keytar.findCredentials(SERVICE_NAME);
  
  return credentials
    .filter(cred => cred.account.startsWith(`${WALLET_PREFIX}-`))
    .map(cred => cred.account.replace(`${WALLET_PREFIX}-`, ""));
}

/**
 * Removes all ChainPe agent credentials from the keychain
 * Use with caution - this will delete all stored mnemonics!
 * 
 * @returns Number of entries deleted
 */
export async function clearAllCredentials(): Promise<number> {
  const credentials = await keytar.findCredentials(SERVICE_NAME);
  let deleted = 0;
  
  for (const cred of credentials) {
    const success = await keytar.deletePassword(SERVICE_NAME, cred.account);
    if (success) deleted++;
  }
  
  return deleted;
}

/**
 * Tests if the keychain is accessible
 * Useful for checking if the system supports keychain storage
 * 
 * @returns true if keychain is accessible
 */
export async function isKeychainAvailable(): Promise<boolean> {
  try {
    // Try to list credentials - this will fail if keychain is unavailable
    await keytar.findCredentials(SERVICE_NAME);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Migration Helpers
// ============================================================================

/**
 * Migrates a plaintext mnemonic to the keychain
 * 
 * @param walletAddress - The wallet address
 * @param plaintextMnemonic - The mnemonic to migrate
 * @returns true if migration was successful
 */
export async function migrateToKeychain(
  walletAddress: string,
  plaintextMnemonic: string
): Promise<boolean> {
  try {
    // Check if already in keychain
    const existing = await getMnemonic(walletAddress);
    if (existing) {
      // Already migrated
      return true;
    }
    
    // Store in keychain
    await saveMnemonic(walletAddress, plaintextMnemonic);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Debug / Development Helpers
// ============================================================================

/**
 * Gets information about stored credentials (without revealing secrets)
 * Useful for debugging keychain issues
 */
export async function getCredentialInfo(): Promise<{
  available: boolean;
  walletCount: number;
  wallets: string[];
}> {
  const available = await isKeychainAvailable();
  
  if (!available) {
    return { available: false, walletCount: 0, wallets: [] };
  }
  
  const wallets = await listStoredWallets();
  return {
    available: true,
    walletCount: wallets.length,
    wallets: wallets.map(w => `${w.slice(0, 8)}...${w.slice(-4)}`), // Truncated for privacy
  };
}
