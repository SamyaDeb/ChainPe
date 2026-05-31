/**
 * ChainPe Terminal WalletConnect Registration
 * 
 * Displays a QR code in the terminal that users can scan with Pera Wallet mobile app
 * to sign the registration transaction.
 * 
 * Uses WalletConnect v1 with Pera Wallet bridge infrastructure
 */

// @ts-ignore - WalletConnect v1 has complex module structure
import WalletConnectClientModule from "@walletconnect/client";
import type { IConnector } from "@walletconnect/types";
import QRCode from "qrcode-terminal";
import algosdk from "algosdk";
import fs from "fs";
import path from "path";
import os from "os";
import type { ChainPeConfig, PaymentToken } from "./types.js";
import { createAlgodClient } from "./facilitator/index.js";
import chalk from "chalk";

// Handle the default export properly
const WalletConnectClient = (WalletConnectClientModule as any).default || WalletConnectClientModule;

// Default admin address - receives registration fees
// This can be overridden via CHAINPE_ADMIN_ADDRESS environment variable
const DEFAULT_ADMIN_ADDRESS = "CIQZP6I73Q5527QWZHZLZBIDSOHVV5LMP5IEQNQYVRXYOZTQSYB7X57PBE";
const ADMIN_ADDRESS = process.env.CHAINPE_ADMIN_ADDRESS || DEFAULT_ADMIN_ADDRESS;

const REGISTRATION_FEE = 1_000_000n; // 1 ALGO
const DEFAULT_APP_ID = 757478481n;

function readAppIdFromConfig(): bigint | undefined {
  try {
    const configPath = path.join(os.homedir(), ".chainpe", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as ChainPeConfig;
    if (config.registryAppId) return BigInt(config.registryAppId);
  } catch {
    // Ignore invalid/missing config and use fallback
  }
  return undefined;
}

function getRegistryAppId(): bigint {
  const envId = process.env.CHAINPE_REGISTRY_APP_ID;
  if (envId) return BigInt(envId);
  return readAppIdFromConfig() ?? DEFAULT_APP_ID;
}

function formatAlgoFromMicro(micro: bigint): string {
  return (Number(micro) / 1_000_000).toFixed(6);
}

// Pera Wallet WalletConnect v1 bridge
const PERA_BRIDGE = "https://wallet-connect-a.perawallet.app";

// Algorand chain IDs for WalletConnect v1
const ALGORAND_TESTNET_CHAIN_ID = 416001;
const ALGORAND_MAINNET_CHAIN_ID = 416002;

export interface WalletConnectRegistrationParams {
  walletAddress: string;
  name: string;
  description: string;
  tags: string[];
  endpoint: string;
  pricePerRequest: string;
  paymentToken: PaymentToken;
  network: "testnet" | "mainnet";
  isUpdate?: boolean;
}

/**
 * Register service using WalletConnect v1 with terminal QR code
 */
export async function registerWithWalletConnectTerminal(
  params: WalletConnectRegistrationParams
): Promise<{
  success: boolean;
  txnHash?: string;
  error?: string;
}> {
  console.log();
  console.log(chalk.cyan("  Initializing WalletConnect..."));

  let connector: IConnector | null = null;

  try {
    // Initialize WalletConnect v1 connector
    connector = new WalletConnectClient({
      bridge: PERA_BRIDGE,
      clientMeta: {
        name: "ChainPe",
        description: "AI Agent Marketplace on Algorand",
        url: "https://chainpe.io",
        icons: ["https://chainpe.io/icon.png"],
      },
    });

    // Ensure connector was initialized
    if (!connector) {
      return { success: false, error: "Failed to initialize WalletConnect connector" };
    }

    // Check if already connected (from previous session)
    if (connector.connected) {
      await connector.killSession();
    }

    // Create new session (generates connection URI)
    await connector.createSession();

    if (!connector.uri) {
      return { success: false, error: "Failed to generate WalletConnect URI" };
    }

    // Display QR code in terminal
    console.log();
    console.log(chalk.yellow("  Scan with Pera Wallet:"));
    console.log();
    
    QRCode.generate(connector.uri, { small: true }, (qrcode) => {
      // Indent each line for better formatting
      const lines = qrcode.split('\n');
      lines.forEach(line => console.log('  ' + line));
    });
    
    console.log();
    console.log(chalk.gray("  Waiting for wallet connection..."));
    console.log(chalk.gray("  (Timeout: 3 minutes)"));
    console.log();

    // Wait for connection with timeout using event-based approach
    const connectionPromise = new Promise<string>((resolve, reject) => {
      if (!connector) {
        reject(new Error("Connector not initialized"));
        return;
      }
      
      connector.on("connect", (error: Error | null, payload: any) => {
        if (error) {
          reject(error);
        } else {
          // v1 returns accounts directly (not CAIP-10 format)
          const { accounts } = payload.params[0];
          if (accounts && accounts.length > 0) {
            resolve(accounts[0]);
          } else {
            reject(new Error("No accounts found in session"));
          }
        }
      });

      connector.on("disconnect", () => {
        reject(new Error("Wallet disconnected during connection"));
      });
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Connection timed out after 3 minutes")), 3 * 60 * 1000);
    });

    let connectedAddress: string;
    try {
      connectedAddress = await Promise.race([connectionPromise, timeoutPromise]);
    } catch (error) {
      const message = (error as Error).message;
      console.log();
      console.log(chalk.red(`  ✗ Connection failed: ${message}`));
      console.log();
      console.log(chalk.gray("  Troubleshooting tips:"));
      console.log(chalk.gray("    1. Make sure Pera Wallet app is installed"));
      console.log(chalk.gray("    2. Scan the QR code completely"));
      console.log(chalk.gray("    3. Check your internet connection"));
      console.log(chalk.gray("    4. Try the mnemonic option if QR code fails"));
      console.log();
      
      // Clean up
      if (connector && connector.connected) {
        await connector.killSession().catch(() => {});
      }
      
      return { success: false, error: message };
    }

    console.log(chalk.green(`  ✓ Connected!`));
    console.log(chalk.gray(`    Address: ${connectedAddress.slice(0, 8)}...${connectedAddress.slice(-4)}`));
    console.log();

    // Build and sign transaction
    console.log(chalk.cyan("  Building registration transaction..."));

    const algod = createAlgodClient(params.network);
    const sp = await algod.getTransactionParams().do();

    const appId = getRegistryAppId();
    const appAddress = algosdk.getApplicationAddress(appId);

    // Build box key
    const boxKey = buildBoxKey(connectedAddress, params.name);

    // Calculate MBR for box storage
    const nameBytes = new TextEncoder().encode(params.name);
    const boxKeySize = 4 + 32 + 1 + nameBytes.length;
    const boxValueSize = 1024;
    const boxMbr = BigInt(2500 + 400 * (boxKeySize + boxValueSize));

    // Preflight balance check to avoid opaque overspend errors from algod
    const accountInfo = await algod.accountInformation(connectedAddress).do();
    const accountBalance = BigInt(accountInfo.amount ?? 0);
    const minFee = BigInt(sp.minFee ?? 1000);
    const estimatedFees = minFee + minFee + 2000n; // fund + pay + appCall(flatFee=2000)
    const totalRequired = boxMbr + REGISTRATION_FEE + estimatedFees;

    if (accountBalance < totalRequired) {
      const shortfall = totalRequired - accountBalance;
      console.log();
      console.log(chalk.red("  ✗ Insufficient ALGO for registration"));
      console.log(chalk.gray(`    Connected wallet: ${connectedAddress}`));
      console.log(chalk.gray(`    Registration fee (to admin ${ADMIN_ADDRESS.slice(0, 8)}...${ADMIN_ADDRESS.slice(-4)}): ${formatAlgoFromMicro(REGISTRATION_FEE)} ALGO`));
      console.log(chalk.gray(`    Box storage funding: ${formatAlgoFromMicro(boxMbr)} ALGO`));
      console.log(chalk.gray(`    Estimated network fees: ${formatAlgoFromMicro(estimatedFees)} ALGO`));
      console.log(chalk.gray(`    Total required: ${formatAlgoFromMicro(totalRequired)} ALGO`));
      console.log(chalk.gray(`    Current balance: ${formatAlgoFromMicro(accountBalance)} ALGO`));
      console.log(chalk.yellow(`    Shortfall: ${formatAlgoFromMicro(shortfall)} ALGO`));
      console.log();
      console.log(chalk.gray("    Fund this wallet and run: chainpe register"));
      console.log(chalk.gray("    Testnet dispenser: https://bank.testnet.algorand.network/"));
      console.log();

      if (connector && connector.connected) {
        await connector.killSession().catch(() => {});
      }

      return {
        success: false,
        error: `Insufficient balance: need ${formatAlgoFromMicro(totalRequired)} ALGO, have ${formatAlgoFromMicro(accountBalance)} ALGO`,
      };
    }

    // Build method selector
    const methodSig = params.isUpdate
      ? 'update(pay,string,string,string,string,string,string,string,string)void'
      : 'register(pay,string,string,string,string,string,string,string,string)void';
    const selector = new Uint8Array(
      algosdk.ABIMethod.fromSignature(methodSig).getSelector()
    );

    // Build app args
    const appArgs = [
      selector,
      encodeArc4String(params.name),
      encodeArc4String(params.description),
      encodeArc4String(params.tags.join(', ')),
      encodeArc4String(params.endpoint),
      encodeArc4String(params.pricePerRequest),
      encodeArc4String(params.paymentToken),
      encodeArc4String(params.walletAddress),
      encodeArc4String(params.network),
    ];

    // Transaction 1: Fund app for box storage
    const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: connectedAddress,
      receiver: appAddress.toString(),
      amount: boxMbr,
      suggestedParams: sp,
    });

    // Transaction 2: Pay admin registration fee
    const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: connectedAddress,
      receiver: ADMIN_ADDRESS,
      amount: REGISTRATION_FEE,
      suggestedParams: sp,
    });

    // Transaction 3: Application call
    const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: connectedAddress,
      appIndex: appId,
      appArgs: appArgs,
      boxes: [{ appIndex: appId, name: boxKey }],
      suggestedParams: { ...sp, fee: 2000n, flatFee: true },
    });

    // Group transactions
    const txnGroup = [fundTxn, payTxn, appCallTxn];
    algosdk.assignGroupID(txnGroup);

    console.log(chalk.gray(`    Registration fee recipient: ${ADMIN_ADDRESS}`));
    console.log(chalk.gray(`    Registration fee amount: ${formatAlgoFromMicro(REGISTRATION_FEE)} ALGO`));

    console.log(chalk.yellow("  Check Pera Wallet - approve the transaction..."));
    console.log();

    // Format transactions for WalletConnect v1 signing (Pera Wallet format)
    // Each transaction needs: txn (base64), signers (optional array), message (optional)
    // For transactions that need signing, signers should be undefined or empty
    // For transactions that don't need signing (e.g., signed by another party), signers: []
    const txnsToSign = txnGroup.map((txn) => {
      return {
        txn: Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString("base64"),
      };
    });

    // Request signature via WalletConnect v1 using algo_signTxn
    // Pera Wallet expects params as an array containing the array of transaction objects
    let signResult: any;
    try {
      signResult = await connector.sendCustomRequest({
        method: "algo_signTxn",
        params: [txnsToSign],
      });
    } catch (error) {
      const message = (error as Error).message;
      console.log();
      console.log(chalk.red(`  ✗ Transaction rejected: ${message}`));
      console.log();
      
      // Clean up
      if (connector && connector.connected) {
        await connector.killSession().catch(() => {});
      }
      
      return { success: false, error: `Transaction rejected: ${message}` };
    }

    console.log(chalk.cyan("  Submitting to Algorand..."));

    // Decode and submit signed transactions
    const signedTxns: Uint8Array[] = [];
    for (const element of signResult as (string | null)[]) {
      if (element) {
        signedTxns.push(new Uint8Array(Buffer.from(element, "base64")));
      }
    }

    const response = await algod.sendRawTransaction(signedTxns).do();
    const txId = response.txid;

    console.log(chalk.cyan("  Waiting for confirmation..."));
    await algosdk.waitForConfirmation(algod, txId, 8);

    console.log();
    console.log(chalk.green.bold("  ✓ Service registered on-chain!"));
    console.log(chalk.gray(`    Transaction: ${txId}`));
    console.log();

    // Disconnect session
    if (connector && connector.connected) {
      await connector.killSession();
    }

    return { success: true, txnHash: txId };

  } catch (error) {
    const message = (error as Error).message;
    console.log();
    console.log(chalk.red(`  ✗ ${message}`));
    console.log();
    
    // Clean up on error
    if (connector && connector.connected) {
      await connector.killSession().catch(() => {});
    }
    
    return { success: false, error: message };
  }
}

// Helper functions
function buildBoxKey(senderAddr: string, serviceName: string): Uint8Array {
  const prefix = new TextEncoder().encode('svc:');
  const senderBytes = algosdk.decodeAddress(senderAddr).publicKey;
  const colon = new TextEncoder().encode(':');
  const nameBytes = new TextEncoder().encode(serviceName);
  const key = new Uint8Array(prefix.length + senderBytes.length + colon.length + nameBytes.length);
  let pos = 0;
  key.set(prefix, pos); pos += prefix.length;
  key.set(senderBytes, pos); pos += senderBytes.length;
  key.set(colon, pos); pos += colon.length;
  key.set(nameBytes, pos);
  return key;
}

function encodeArc4String(s: string): Uint8Array {
  const utf8 = new TextEncoder().encode(s);
  const buf = new Uint8Array(2 + utf8.length);
  new DataView(buf.buffer).setUint16(0, utf8.length, false);
  buf.set(utf8, 2);
  return buf;
}
