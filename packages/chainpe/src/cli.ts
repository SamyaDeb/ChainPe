#!/usr/bin/env node

/**
 * ChainPe CLI
 * Beautiful terminal interface for the x402 payment gateway on Algorand
 */

import { program } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import gradient from "gradient-string";
import ora from "ora";
import fs from "fs/promises";
import path from "path";
import os from "os";
import algosdk from "algosdk";

import type { ChainPeConfig, PaymentToken, ServiceRegistration, Registry } from "./types.js";
import {
  isValidAlgorandAddress,
  createAlgodClient,
  getAccountInfo,
  formatAlgo,
} from "./facilitator/index.js";
import { startProxyServer } from "./proxy/index.js";
import { logger, setLogLevel } from "./logger.js";
import { ChainPeRegistryClient } from "./registry.js";
import { registerWithWalletConnectTerminal } from "./wallet-connect-terminal.js";

// ============================================================================
// Constants
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), ".chainpe");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const REGISTRY_FILE = path.join(CONFIG_DIR, "registry.json");
const DEFAULT_REGISTRY_APP_ID = "757478481";

const VERSION = "1.0.0";

// Beautiful gradient for the banner
const chainpeGradient = gradient(["#00D9FF", "#00FF94", "#FFD93D"]);

function getRegistryAppIdForConfig(): string {
  return process.env.CHAINPE_REGISTRY_APP_ID || DEFAULT_REGISTRY_APP_ID;
}

// ============================================================================
// Banner & Styling
// ============================================================================

function printBanner(): void {
  console.log();
  console.log(
    chainpeGradient.multiline(`
   _____ _           _       _____      
  / ____| |         (_)     |  __ \\     
 | |    | |__   __ _ _ _ __ | |__) |___ 
 | |    | '_ \\ / _\` | | '_ \\|  ___/ _ \\
 | |____| | | | (_| | | | | | |  |  __/
  \\_____|_| |_|\\__,_|_|_| |_|_|   \\___|
`)
  );
  console.log(
    chalk.gray("  AI Agent Marketplace on Algorand • x402 Micropayments")
  );
  console.log();
}

function printSection(title: string): void {
  console.log();
  console.log(chalk.cyan.bold(`▸ ${title}`));
  console.log(chalk.gray("─".repeat(50)));
}

// ============================================================================
// File Operations
// ============================================================================

async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

async function loadConfig(): Promise<ChainPeConfig | null> {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(data) as ChainPeConfig;
  } catch {
    return null;
  }
}

async function saveConfig(config: ChainPeConfig): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function loadRegistry(): Promise<Registry> {
  try {
    const data = await fs.readFile(REGISTRY_FILE, "utf-8");
    return JSON.parse(data) as Registry;
  } catch {
    return { version: "1.0.0", services: [] };
  }
}

async function saveRegistry(registry: Registry): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

// ============================================================================
// Validation
// ============================================================================

function validateUrl(value: string | undefined): string | undefined {
  if (!value) return "URL is required";
  try {
    new URL(value);
    return undefined;
  } catch {
    return "Please enter a valid URL (e.g., http://localhost:3000)";
  }
}

function validatePrice(value: string | undefined): string | undefined {
  if (!value) return "Price is required";
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) {
    return "Please enter a valid positive number";
  }
  return undefined;
}

function validatePort(value: string | undefined): string | undefined {
  if (!value) return "Port is required";
  const port = parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    return "Please enter a valid port number (1-65535)";
  }
  return undefined;
}

function validateWalletAddress(value: string | undefined): string | undefined {
  if (!value) return "Wallet address is required";
  if (!isValidAlgorandAddress(value)) {
    return "Please enter a valid Algorand address (58 characters)";
  }
  return undefined;
}

// ============================================================================
// Init Command
// ============================================================================

async function runInit(): Promise<void> {
  printBanner();

  p.intro(chalk.bgCyan.black(" ChainPe Setup "));

  // Check for existing config
  const existingConfig = await loadConfig();
  if (existingConfig) {
    const shouldOverwrite = await p.confirm({
      message: "Configuration already exists. Overwrite?",
      initialValue: false,
    });

    if (p.isCancel(shouldOverwrite) || !shouldOverwrite) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
  }

  printSection("Service Configuration");

  const targetUrl = await p.text({
    message: "Your API URL (the backend ChainPe will proxy)",
    placeholder: "http://localhost:3000",
    validate: validateUrl,
  });

  if (p.isCancel(targetUrl)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  const serviceName = await p.text({
    message: "Service name (for registry listing)",
    placeholder: "My AI Agent API",
    validate: (value) => (!value || value.length < 3 ? "Name must be at least 3 characters" : undefined),
  });

  if (p.isCancel(serviceName)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  const serviceDescription = await p.text({
    message: "Service description",
    placeholder: "AI-powered research assistant that analyzes documents",
    validate: (value) => (!value || value.length < 10 ? "Description must be at least 10 characters" : undefined),
  });

  if (p.isCancel(serviceDescription)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  const tags = await p.text({
    message: "Tags (comma-separated, for discovery)",
    placeholder: "ai, research, documents, nlp",
  });

  if (p.isCancel(tags)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  printSection("Pricing");

  const pricePerRequest = await p.text({
    message: "Price per request",
    placeholder: "0.01",
    validate: validatePrice,
  });

  if (p.isCancel(pricePerRequest)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  const paymentToken = await p.select({
    message: "Payment token",
    options: [
      { value: "ALGO", label: "ALGO", hint: "Algorand native token" },
      { value: "USDC", label: "USDC", hint: "USD Coin (ASA)" },
    ],
  });

  if (p.isCancel(paymentToken)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  printSection("Wallet Configuration");

  console.log(chalk.gray("  Your wallet address will receive all payments."));
  console.log(chalk.gray("  No mnemonic needed - you just receive payments!\n"));

  const walletAddress = await p.text({
    message: "Your Algorand wallet address (to receive payments)",
    placeholder: "ALGO...",
    validate: validateWalletAddress,
  });

  if (p.isCancel(walletAddress)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Check wallet balance on testnet
  const spinner = ora("Validating wallet address...").start();
  try {
    const algod = createAlgodClient("testnet");
    const info = await getAccountInfo(algod, walletAddress as string);
    const algoBalance = formatAlgo(info.balance);
    spinner.succeed(`Wallet verified! Balance: ${chalk.green(algoBalance)} ALGO`);
  } catch (error) {
    spinner.succeed(`Wallet address accepted: ${chalk.cyan((walletAddress as string).slice(0, 8))}...${chalk.cyan((walletAddress as string).slice(-4))}`);
  }

  printSection("Server Configuration");

  const proxyPort = await p.text({
    message: "Proxy port",
    placeholder: "4402",
    initialValue: "4402",
    validate: validatePort,
  });

  if (p.isCancel(proxyPort)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Build config
  const config: ChainPeConfig = {
    serviceName: serviceName as string,
    serviceDescription: serviceDescription as string,
    tags: (tags as string).split(",").map((t) => t.trim()).filter(Boolean),
    targetUrl: targetUrl as string,
    pricePerRequest: pricePerRequest as string,
    paymentToken: paymentToken as PaymentToken,
    walletAddress: walletAddress as string,
    proxyPort: parseInt(proxyPort as string, 10),
    network: "testnet",
    registryAppId: getRegistryAppIdForConfig(),
    logLevel: "normal",
  };

  // Save config (no mnemonic needed for provider - they just receive payments)
  spinner.start("Saving configuration...");
  try {
    await saveConfig(config);
    spinner.succeed("Configuration saved!");
  } catch (error) {
    spinner.fail("Failed to save configuration");
    p.cancel("Setup failed");
    process.exit(1);
  }

  // Summary
  console.log();
  console.log(chalk.green.bold("✓ Configuration complete!"));
  console.log();
  console.log(chalk.gray("  Your API will be monetized:"));
  console.log(chalk.gray(`    Target:   ${chalk.white(config.targetUrl)}`));
  console.log(chalk.gray(`    Price:    ${chalk.green(config.pricePerRequest)} ${config.paymentToken} per request`));
  console.log(chalk.gray(`    Payments: ${chalk.cyan(config.walletAddress.slice(0, 8))}...${chalk.cyan(config.walletAddress.slice(-4))}`));
  console.log();

  // Ask if they want to register on-chain
  printSection("On-Chain Registration");
  
  console.log(chalk.gray("  Register your service on Algorand so AI agents can discover it."));
  console.log(chalk.gray("  This requires signing a transaction with your wallet (~1.5 ALGO fee)."));
  console.log();

  const shouldRegister = await p.confirm({
    message: "Register service on-chain now?",
    initialValue: true,
  });

  if (p.isCancel(shouldRegister)) {
    console.log();
    console.log(chalk.gray(`  You can register later with: ${chalk.cyan("chainpe register")}`));
    console.log(chalk.gray(`  Start the proxy with: ${chalk.cyan("chainpe start")}`));
    console.log();
    process.exit(0);
  }

  if (shouldRegister) {
    // Ask for endpoint
    const endpoint = await p.text({
      message: "Public endpoint URL (where clients will connect)",
      placeholder: `http://localhost:${config.proxyPort}`,
      initialValue: `http://localhost:${config.proxyPort}`,
      validate: validateUrl,
    });

    if (p.isCancel(endpoint)) {
      console.log();
      console.log(chalk.gray(`  You can register later with: ${chalk.cyan("chainpe register")}`));
      console.log();
    } else {
      // Check if already registered so we call update() instead of register()
      const initRegistryClient = new ChainPeRegistryClient(config.network);
      const initAlreadyExists = await initRegistryClient.hasService(config.walletAddress, config.serviceName);
      const initIsUpdate = initAlreadyExists;
      if (initIsUpdate) {
        console.log(chalk.yellow("  ℹ Service already registered — will call update() on-chain."));
        console.log();
      }

      // Ask for registration method
      const registrationMethod = await p.select({
        message: "How would you like to sign the registration transaction?",
        options: [
          { value: "qr", label: "📱 Scan QR code with Pera Wallet mobile app (Recommended)" },
          { value: "mnemonic", label: "🔑 Paste 25-word mnemonic phrase" },
          { value: "address", label: "⏭️  Skip - register manually later" },
        ],
      });

      if (p.isCancel(registrationMethod)) {
        console.log();
        console.log(chalk.gray(`  You can register later with: ${chalk.cyan("chainpe register")}`));
        console.log();
      } else if (registrationMethod === "address") {
        // Skip registration, user will do it manually
        console.log();
        console.log(chalk.yellow("  ⚠ Skipping on-chain registration"));
        console.log(chalk.gray(`  You can register later with: ${chalk.cyan("chainpe register")}`));
        console.log();
      } else if (registrationMethod === "qr") {
        // Register with QR code (WalletConnect)
        console.log();

        try {
          const result = await registerWithWalletConnectTerminal({
            walletAddress: config.walletAddress,
            name: config.serviceName,
            description: config.serviceDescription,
            tags: config.tags,
            endpoint: endpoint as string,
            pricePerRequest: config.pricePerRequest,
            paymentToken: config.paymentToken,
            network: config.network,
            isUpdate: initIsUpdate,
          });

          if (!result.success) {
            console.log(chalk.yellow(`  ⚠ Registration failed: ${result.error || "Unknown error"}`));
            console.log(chalk.gray(`  You can try again with: ${chalk.cyan("chainpe register")}`));
            console.log();
          }
        } catch (error) {
          console.log(chalk.yellow(`  ⚠ Registration failed: ${(error as Error).message}`));
          console.log(chalk.gray(`  You can try again with: ${chalk.cyan("chainpe register")}`));
          console.log();
        }
      } else if (registrationMethod === "mnemonic") {
        // Register with mnemonic
        const mnemonic = await p.password({
          message: "Enter your 25-word mnemonic phrase",
          validate: (value) => {
            if (!value || value.trim().split(/\s+/).length !== 25) {
              return "Mnemonic must be exactly 25 words";
            }
            try {
              algosdk.mnemonicToSecretKey(value.trim());
              return;
            } catch {
              return "Invalid mnemonic phrase";
            }
          },
        });

        if (p.isCancel(mnemonic)) {
          console.log();
          console.log(chalk.gray(`  You can register later with: ${chalk.cyan("chainpe register")}`));
          console.log();
        } else {
          const spinner = ora(initIsUpdate ? "Updating service on-chain..." : "Registering service on-chain...").start();

          try {
            const result = await initRegistryClient.registerService({
              mnemonic: mnemonic as string,
              isUpdate: initIsUpdate,
              name: config.serviceName,
              description: config.serviceDescription,
              tags: config.tags,
              endpoint: endpoint as string,
              pricePerRequest: config.pricePerRequest,
              paymentToken: config.paymentToken,
              walletAddress: config.walletAddress,
              network: config.network,
            });

            spinner.succeed(initIsUpdate ? "Service updated on-chain!" : "Service registered on-chain!");
            console.log(chalk.gray(`  Transaction: ${chalk.cyan(result.txnHash.slice(0, 20))}...`));
            console.log();
          } catch (error) {
            spinner.fail(initIsUpdate ? "Update failed" : "Registration failed");
            console.log(chalk.yellow(`  Error: ${(error as Error).message}`));
            console.log(chalk.gray(`  You can try again with: ${chalk.cyan("chainpe register")}`));
            console.log();
          }
        }
      }
    }
  } else {
    console.log();
    console.log(chalk.gray(`  You can register later with: ${chalk.cyan("chainpe register")}`));
    console.log();
  }

  // Ask if they want to start the proxy now
  printSection("Start Proxy");

  const shouldStart = await p.confirm({
    message: "Start the payment proxy now?",
    initialValue: true,
  });

  if (p.isCancel(shouldStart) || !shouldStart) {
    console.log();
    console.log(chalk.gray("  Start later with:"));
    console.log(chalk.white(`    ${chalk.cyan("chainpe start")}`));
    console.log(chalk.gray("  Or with local facilitator (no external server needed):"));
    console.log(chalk.white(`    ${chalk.cyan("chainpe start --facilitator \"your 25 word mnemonic\"")}`));
    console.log();
    p.outro(chalk.green("Setup complete! 🚀"));
    process.exit(0);
  }

  // Ask if they want to use local facilitator mode
  console.log();
  console.log(chalk.gray("  The x402 payment system needs a facilitator to verify payments."));
  console.log(chalk.gray("  You can use the remote facilitator (default) or run locally."));
  console.log();
  
  const facilitatorMode = await p.select({
    message: "Choose facilitator mode",
    options: [
      { value: "remote", label: "🌐 Remote facilitator (Recommended)", hint: "Uses external server - simpler setup" },
      { value: "local", label: "💻 Local facilitator", hint: "Run in-process - needs a funded wallet" },
    ],
  });
  
  let facilitatorMnemonic: string | undefined;
  
  if (facilitatorMode === "local") {
    console.log();
    console.log(chalk.yellow("  Local facilitator requires a wallet with ALGO to pay tx fees."));
    console.log(chalk.gray("  This wallet is ONLY used to verify/settle payments - it doesn't receive them."));
    console.log();
    
    const mnemonic = await p.password({
      message: "Enter 25-word mnemonic for facilitator wallet",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Mnemonic is required";
        }
        const words = value.trim().split(/\s+/);
        if (words.length !== 25) {
          return `Expected 25 words, got ${words.length}`;
        }
        try {
          algosdk.mnemonicToSecretKey(value.trim());
          return undefined;
        } catch {
          return "Invalid mnemonic phrase";
        }
      },
    });
    
    if (p.isCancel(mnemonic)) {
      console.log(chalk.gray("  Falling back to remote facilitator..."));
    } else {
      facilitatorMnemonic = mnemonic as string;
    }
  }

  // Start the proxy
  console.log();
  console.log(chalk.gray("  Starting x402 payment gateway..."));
  console.log();

  try {
    await startProxyServer({ config, facilitatorMnemonic });

    console.log(chalk.gray("  Press Ctrl+C to stop"));
    console.log();

    process.on("SIGINT", () => {
      console.log();
      console.log(chalk.yellow("  Shutting down..."));
      process.exit(0);
    });
  } catch (error) {
    console.log(chalk.red(`✗ Failed to start server: ${(error as Error).message}`));
    process.exit(1);
  }
}

// ============================================================================
// Start Command
// ============================================================================

async function runStart(options: { port?: string; verbose?: boolean; facilitator?: string }): Promise<void> {
  printBanner();

  const config = await loadConfig();

  if (!config) {
    console.log(chalk.red("✗ No configuration found."));
    console.log(chalk.gray(`  Run ${chalk.cyan("chainpe init")} first.`));
    process.exit(1);
  }

  // Override port if specified
  if (options.port) {
    config.proxyPort = parseInt(options.port, 10);
  }

  // Set log level
  if (options.verbose) {
    setLogLevel("verbose");
  } else if (config.logLevel) {
    setLogLevel(config.logLevel);
  }

  console.log(chalk.gray("  Starting x402 payment gateway..."));
  console.log();

  // Display config summary
  console.log(chalk.gray("  Configuration:"));
  console.log(chalk.gray(`    Service:  ${chalk.white(config.serviceName)}`));
  console.log(chalk.gray(`    Target:   ${chalk.white(config.targetUrl)}`));
  console.log(chalk.gray(`    Price:    ${chalk.green(config.pricePerRequest)} ${config.paymentToken}`));
  console.log(chalk.gray(`    Wallet:   ${chalk.cyan(config.walletAddress.slice(0, 8))}...${chalk.cyan(config.walletAddress.slice(-4))}`));
  console.log(chalk.gray(`    Network:  ${chalk.yellow(config.network)}`));
  
  // Show verification mode
  if (options.facilitator) {
    console.log(chalk.gray(`    Mode:     ${chalk.green("Local facilitator (with signing)")}`));
  } else {
    console.log(chalk.gray(`    Mode:     ${chalk.green("Simple verifier (no mnemonic needed)")}`));
  }
  console.log();

  try {
    await startProxyServer({ 
      config, 
      facilitatorMnemonic: options.facilitator 
    });

    console.log(chalk.gray("  Press Ctrl+C to stop"));
    console.log();

    // Keep the process running
    process.on("SIGINT", () => {
      console.log();
      console.log(chalk.yellow("  Shutting down..."));
      process.exit(0);
    });
  } catch (error) {
    console.log(chalk.red(`✗ Failed to start server: ${(error as Error).message}`));
    process.exit(1);
  }
}

// ============================================================================
// Register Command
// ============================================================================

async function runRegister(): Promise<void> {
  printBanner();

  const config = await loadConfig();

  if (!config) {
    console.log(chalk.red("✗ No configuration found."));
    console.log(chalk.gray(`  Run ${chalk.cyan("chainpe init")} first.`));
    process.exit(1);
  }

  p.intro(chalk.bgCyan.black(" Register Service On-Chain "));

  // Ask for the public endpoint URL
  const endpoint = await p.text({
    message: "Public endpoint URL (where clients will connect)",
    placeholder: `http://localhost:${config.proxyPort}`,
    initialValue: `http://localhost:${config.proxyPort}`,
    validate: validateUrl,
  });

  if (p.isCancel(endpoint)) {
    p.cancel("Registration cancelled");
    process.exit(0);
  }

  // Check if service is already registered so we can call update() instead of register()
  const registryClient = new ChainPeRegistryClient(config.network);
  const alreadyExists = await registryClient.hasService(config.walletAddress, config.serviceName);
  const isUpdate = alreadyExists;

  console.log();
  console.log(chalk.gray(`  Service to ${isUpdate ? "update" : "register"}:`));
  console.log(chalk.gray(`    Name:     ${chalk.white(config.serviceName)}`));
  console.log(chalk.gray(`    Price:    ${chalk.green(config.pricePerRequest)} ${config.paymentToken}`));
  console.log(chalk.gray(`    Endpoint: ${chalk.cyan(endpoint as string)}`));
  console.log(chalk.gray(`    Wallet:   ${chalk.cyan(config.walletAddress.slice(0, 8))}...${chalk.cyan(config.walletAddress.slice(-4))}`));
  if (isUpdate) {
    console.log(chalk.yellow("  ℹ Service already registered — will call update() on-chain."));
  }
  console.log();
  console.log(chalk.gray("  Fee: ~1.5 ALGO (1 ALGO registration + storage)"));
  console.log();

  // Ask for registration method
  const registrationMethod = await p.select({
    message: "How would you like to sign the registration transaction?",
    options: [
      { value: "qr", label: "Scan QR code with Pera Wallet (Recommended)", hint: "Mobile app" },
      { value: "mnemonic", label: "Paste 25-word mnemonic phrase", hint: "Direct signing" },
    ],
  });

  if (p.isCancel(registrationMethod)) {
    p.cancel("Registration cancelled");
    process.exit(0);
  }

  if (registrationMethod === "qr") {
    // Register with QR code (WalletConnect terminal)
    console.log();
    
    try {
      const result = await registerWithWalletConnectTerminal({
        walletAddress: config.walletAddress,
        name: config.serviceName,
        description: config.serviceDescription,
        tags: config.tags,
        endpoint: endpoint as string,
        pricePerRequest: config.pricePerRequest,
        paymentToken: config.paymentToken,
        network: config.network,
        isUpdate,
      });

      if (result.success && result.txnHash) {
        const explorerBase = config.network === "mainnet" 
          ? "https://explorer.perawallet.app" 
          : "https://testnet.explorer.perawallet.app";
        console.log(chalk.gray(`    Explorer: ${chalk.cyan(`${explorerBase}/tx/${result.txnHash}/`)}`));
        console.log();
        p.outro(chalk.green("Service is now discoverable on Algorand!"));
      } else {
        console.log();
        console.log(chalk.red(`  ✗ Registration failed: ${result.error || "Unknown error"}`));
        process.exit(1);
      }
    } catch (error) {
      console.log(chalk.red(`  ✗ Registration failed: ${(error as Error).message}`));
      process.exit(1);
    }
  } else if (registrationMethod === "mnemonic") {
    // Register with mnemonic
    const mnemonic = await p.password({
      message: "Enter your 25-word mnemonic phrase",
      validate: (value) => {
        if (!value || value.trim().split(/\s+/).length !== 25) {
          return "Mnemonic must be exactly 25 words";
        }
        try {
          algosdk.mnemonicToSecretKey(value.trim());
          return;
        } catch {
          return "Invalid mnemonic phrase";
        }
      },
    });

    if (p.isCancel(mnemonic)) {
      p.cancel("Registration cancelled");
      process.exit(0);
    }

    const spinner = ora(isUpdate ? "Updating service on-chain..." : "Registering service on-chain...").start();

    try {
      const result = await registryClient.registerService({
        mnemonic: mnemonic as string,
        isUpdate,
        name: config.serviceName,
        description: config.serviceDescription,
        tags: config.tags,
        endpoint: endpoint as string,
        pricePerRequest: config.pricePerRequest,
        paymentToken: config.paymentToken,
        walletAddress: config.walletAddress,
        network: config.network,
      });

      spinner.succeed(isUpdate ? "Service updated on-chain!" : "Service registered on-chain!");
      console.log(chalk.gray(`    Transaction: ${chalk.cyan(result.txnHash)}`));
      const explorerBase = config.network === "mainnet"
        ? "https://explorer.perawallet.app"
        : "https://testnet.explorer.perawallet.app";
      console.log(chalk.gray(`    Explorer: ${chalk.cyan(`${explorerBase}/tx/${result.txnHash}/`)}`));
      console.log();
      p.outro(chalk.green("Service is now discoverable on Algorand!"));
    } catch (error) {
      spinner.fail(isUpdate ? "Update failed" : "Registration failed");
      console.log(chalk.red(`  ✗ ${(error as Error).message}`));
      process.exit(1);
    }
  }
}

// ============================================================================
// List Command
// ============================================================================

async function runList(): Promise<void> {
  printBanner();

  console.log(chalk.cyan.bold("▸ Registered Services (Algorand Testnet)"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();

  const config = await loadConfig();

  if (!config) {
    console.log(chalk.gray("  Run chainpe init first."));
    console.log();
    return;
  }

  const spinner = ora("Fetching service from on-chain registry...").start();

  try {
    const registryClient = new ChainPeRegistryClient(config.network);
    // Use the wallet address from config to look up service
    const svc = await registryClient.getService(config.walletAddress, config.serviceName);

    spinner.stop();

    if (!svc) {
      console.log(chalk.gray("  No service registered on-chain yet."));
      console.log(chalk.gray(`  Run ${chalk.cyan("chainpe register")} to register your service.`));
      console.log();
      return;
    }

    const { appId, appAddress } = registryClient.getContractInfo();
    console.log(chalk.white.bold(`  ${svc.name}`));
    console.log(chalk.gray(`    ${svc.description}`));
    console.log(chalk.gray(`    Endpoint:   ${chalk.cyan(svc.endpoint)}`));
    console.log(chalk.gray(`    Price:      ${chalk.green(svc.pricePerRequest)} ${svc.paymentToken}`));
    console.log(chalk.gray(`    Tags:       ${svc.tags.join(", ")}`));
    console.log(chalk.gray(`    Network:    ${chalk.yellow(svc.network)}`));
    console.log(chalk.gray(`    Developer:  ${chalk.white(svc.developer)}`));
    console.log(chalk.gray(`    App ID:     ${chalk.white(appId.toString())}`));
    console.log();
    console.log(chalk.gray(`  Total: 1 service (on-chain, App ID: ${appId})`));
    console.log();
  } catch (error) {
    spinner.fail("Failed to fetch from on-chain registry");
    console.log(chalk.red(`  ${(error as Error).message}`));
  }
}

// ============================================================================
// Status Command
// ============================================================================

async function runStatus(): Promise<void> {
  printBanner();

  const config = await loadConfig();

  console.log(chalk.cyan.bold("▸ ChainPe Status"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();

  if (!config) {
    console.log(chalk.yellow("  ⚠ Not configured"));
    console.log(chalk.gray(`    Run ${chalk.cyan("chainpe init")} to get started.`));
    console.log();
    return;
  }

  console.log(chalk.gray("  Configuration:"));
  console.log(chalk.gray(`    Service:     ${chalk.white(config.serviceName)}`));
  console.log(chalk.gray(`    Description: ${chalk.white(config.serviceDescription)}`));
  console.log(chalk.gray(`    Target:      ${chalk.white(config.targetUrl)}`));
  console.log(chalk.gray(`    Price:       ${chalk.green(config.pricePerRequest)} ${config.paymentToken}`));
  console.log(chalk.gray(`    Port:        ${chalk.white(config.proxyPort.toString())}`));
  console.log(chalk.gray(`    Network:     ${chalk.yellow(config.network)}`));
  console.log();

  console.log(chalk.gray("  Wallet (receives payments):"));
  console.log(chalk.gray(`    Address:     ${chalk.cyan(config.walletAddress)}`));

  // Check balance
  const spinner = ora("Checking balance...").start();
  try {
    const algod = createAlgodClient("testnet");
    const info = await getAccountInfo(algod, config.walletAddress);
    const algoBalance = formatAlgo(info.balance);
    spinner.stop();
    console.log(chalk.gray(`    Balance:     ${chalk.green(algoBalance)} ALGO`));

    // Check USDC balance if any
    const usdcAsset = info.assets.find((a) => a.assetId === 10458941n);
    if (usdcAsset) {
      const usdcBalance = formatAlgo(usdcAsset.amount);
      console.log(chalk.gray(`                 ${chalk.green(usdcBalance)} USDC`));
    }
  } catch {
    spinner.stop();
    console.log(chalk.gray(`    Balance:     ${chalk.yellow("(could not fetch)")}`));
  }

  console.log();

  // Check on-chain registry
  const registryClient = new ChainPeRegistryClient(config.network);
  const { appId } = registryClient.getContractInfo();
  console.log(chalk.gray("  Registry:"));
  console.log(chalk.gray(`    Contract:    ${chalk.white(`App ID ${appId} (testnet)`)}`));

  // Use wallet address to check registration status
  const spinnerReg = ora("Checking on-chain registration...").start();
  try {
    const isRegistered = await registryClient.hasService(config.walletAddress, config.serviceName);
    spinnerReg.stop();
    console.log(
      chalk.gray(
        `    Status:      ${isRegistered ? chalk.green("✓ registered on-chain") : chalk.yellow("○ not registered")}`
      )
    );
    if (!isRegistered) {
      console.log(chalk.gray(`    Run ${chalk.cyan("chainpe register")} to list your service.`));
    }
  } catch {
    spinnerReg.stop();
    console.log(chalk.gray(`    Status:      ${chalk.yellow("(could not check)")}`));
  }

  console.log();
}

// ============================================================================
// Main CLI
// ============================================================================

program
  .name("chainpe")
  .description("ChainPe — Monetize any API with x402 micropayments on Algorand")
  .version(VERSION);

program
  .command("init")
  .description("Initialize a new ChainPe configuration")
  .action(runInit);

program
  .command("start")
  .description("Start the x402 payment proxy")
  .option("-p, --port <port>", "Override the proxy port")
  .option("-v, --verbose", "Enable verbose logging")
  .option("-f, --facilitator <mnemonic>", "25-word mnemonic for local facilitator (enables offline mode)")
  .action(runStart);

program
  .command("register")
  .description("Register your service in the local registry")
  .action(runRegister);

program
  .command("list")
  .description("List all registered services")
  .action(runList);

program
  .command("status")
  .description("Show current configuration and status")
  .action(runStatus);

program.parse();
