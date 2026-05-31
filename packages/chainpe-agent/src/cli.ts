#!/usr/bin/env node

/**
 * ChainPe Agent CLI
 * Beautiful terminal interface for configuring the AI agent
 * 
 * SECURITY: Wallet mnemonics are stored in OS keychain (macOS Keychain,
 * Linux Secret Service, Windows Credential Manager), never in plaintext files.
 */

import { program } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import gradient from "gradient-string";
import ora from "ora";

import type { LLMProvider, PaymentToken, LLMMode } from "./types.js";
import {
  loadConfig,
  saveConfig,
  buildConfig,
  isValidMnemonic,
  addressFromMnemonic,
  getDefaultModel,
  DEFAULT_MODELS,
  getConfigPath,
  getDefaultRegistryPath,
  saveWalletToKeychain,
  isLegacyConfig,
  migrateToSecureStorage,
  getWalletMnemonic,
} from "./config.js";
import {
  getWalletBalance,
  formatBalance,
} from "./wallet.js";
import { RegistryClient } from "./registry.js";
import { ChainPeAgent } from "./agent.js";
import {
  isKeychainAvailable,
  hasMnemonic,
  getCredentialInfo,
} from "./keychain.js";

// ============================================================================
// Constants
// ============================================================================

const VERSION = "1.0.0";
const DEFAULT_REGISTRY_APP_ID = "757478481";

// Beautiful gradient for the banner
const agentGradient = gradient(["#FF6B6B", "#4ECDC4", "#45B7D1"]);

// ============================================================================
// Banner & Styling
// ============================================================================

function printBanner(): void {
  console.log();
  console.log(
    agentGradient.multiline(`
   _____ _           _       _____         _____            _   
  / ____| |         (_)     |  __ \\       / ____|          | |  
 | |    | |__   __ _ _ _ __ | |__) |___  | |  __  ___ _ __ | |_ 
 | |    | '_ \\ / _\` | | '_ \\|  ___/ _ \\ | | |_ |/ _ \\ '_ \\| __|
 | |____| | | | (_| | | | | | |  |  __/ | |__| |  __/ | | | |_ 
  \\_____|_| |_|\\__,_|_|_| |_|_|   \\___|  \\_____|\\___|_| |_|\\__|
`)
  );
  console.log(
    chalk.gray("  Pre-built AI Agent with x402 Payments on Algorand")
  );
  console.log();
}

function printSection(title: string): void {
  console.log();
  console.log(chalk.cyan.bold(`▸ ${title}`));
  console.log(chalk.gray("─".repeat(50)));
}

// ============================================================================
// Validation
// ============================================================================

function validateApiKey(value: string | undefined): string | undefined {
  if (!value || value.length < 10) {
    return "Please enter a valid API key";
  }
  return undefined;
}

function validateMnemonicInput(value: string | undefined): string | undefined {
  if (!value) return "Mnemonic is required";
  if (!isValidMnemonic(value)) {
    return "Please enter a valid 25-word Algorand mnemonic";
  }
  return undefined;
}

// ============================================================================
// Init Command
// ============================================================================

async function runInit(): Promise<void> {
  printBanner();

  p.intro(chalk.bgMagenta.black(" ChainPe Agent Setup "));

  // Check keychain availability
  const keychainAvailable = await isKeychainAvailable();
  if (!keychainAvailable) {
    console.log(chalk.red("\n  ⚠ OS Keychain is not available on this system."));
    console.log(chalk.yellow("    Your wallet mnemonic cannot be stored securely."));
    console.log(chalk.gray("    Please ensure you have proper system credentials configured."));
    p.cancel("Setup failed - keychain unavailable");
    process.exit(1);
  }

  console.log(chalk.green("\n  ✓ OS Keychain available - your wallet will be stored securely"));

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

  printSection("LLM Configuration");

  const llmMode = await p.select({
    message: "LLM Mode",
    options: [
      { value: "local", label: "Local (Ollama)", hint: "Free, runs on your machine" },
      { value: "api", label: "API (OpenAI/Anthropic/Gemini)", hint: "Cloud-based, requires API key" },
    ],
  });

  if (p.isCancel(llmMode)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  const mode = llmMode as LLMMode;
  let provider: LLMProvider;
  let llmModel: string | symbol;
  let llmApiKey: string = "";
  let llmBaseURL: string = "";

  if (mode === "local") {
    // Local mode - use Ollama
    console.log(chalk.gray("\n  Using Ollama for local LLM."));
    console.log(chalk.gray("  Make sure Ollama is running: brew services start ollama"));
    console.log();

    provider = "openai"; // Use OpenAI-compatible endpoint
    
    const baseURL = await p.text({
      message: "Ollama Base URL",
      initialValue: "http://localhost:11434/v1",
      placeholder: "http://localhost:11434/v1",
    });

    if (p.isCancel(baseURL)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }

    llmBaseURL = baseURL as string;

    const modelName = await p.text({
      message: "Model Name",
      initialValue: "qwen2.5:7b",
      placeholder: "qwen2.5:7b",
    });

    if (p.isCancel(modelName)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }

    llmModel = modelName as string;
    llmApiKey = "ollama"; // Dummy API key for local mode

  } else {
    // API mode - use cloud providers
    const llmProvider = await p.select({
      message: "LLM Provider",
      options: [
        { value: "groq", label: "Groq", hint: "Llama 3.3, fast inference" },
        { value: "openai", label: "OpenAI", hint: "GPT-4o, GPT-4 Turbo" },
        { value: "anthropic", label: "Anthropic", hint: "Claude 3.5 Sonnet, Claude 3 Opus" },
        { value: "gemini", label: "Google Gemini", hint: "Gemini 2.0 Flash, Gemini 1.5 Pro" },
      ],
    });

    if (p.isCancel(llmProvider)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }

    provider = llmProvider as LLMProvider;
    const modelOptions = DEFAULT_MODELS[provider].map((m, i) => ({
      value: m,
      label: m,
      hint: i === 0 ? "recommended" : undefined,
    }));

    llmModel = await p.select({
      message: "Model",
      options: modelOptions,
    });

    if (p.isCancel(llmModel)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }

    const apiKey = await p.password({
      message: `${provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : provider === "groq" ? "Groq" : "Google AI"} API Key`,
      validate: validateApiKey,
    });

    if (p.isCancel(apiKey)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }

    llmApiKey = apiKey;
  }

  printSection("Wallet Configuration (Secure Storage)");

  console.log(chalk.gray("  Your wallet mnemonic will be stored in the OS keychain."));
  console.log(chalk.gray("  It will NEVER be saved in plaintext files."));
  console.log(chalk.gray("  Get testnet ALGO: https://bank.testnet.algorand.network/"));
  console.log();

  const mnemonic = await p.password({
    message: "Algorand Mnemonic (25 words)",
    validate: validateMnemonicInput,
  });

  if (p.isCancel(mnemonic)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Derive address and check balance
  const spinner = ora("Validating wallet...").start();
  let walletAddress: string;

  try {
    walletAddress = addressFromMnemonic(mnemonic);
    spinner.succeed(`Wallet: ${chalk.cyan(walletAddress.slice(0, 8))}...${chalk.cyan(walletAddress.slice(-4))}`);
  } catch (error) {
    spinner.fail("Invalid mnemonic");
    p.cancel("Setup failed");
    process.exit(1);
  }

  // Store mnemonic in OS keychain
  spinner.start("Storing wallet in OS keychain...");
  try {
    await saveWalletToKeychain(walletAddress, mnemonic);
    spinner.succeed(chalk.green("Wallet securely stored in OS keychain"));
  } catch (error) {
    spinner.fail("Failed to store wallet in keychain");
    console.log(chalk.red(`  Error: ${(error as Error).message}`));
    p.cancel("Setup failed");
    process.exit(1);
  }

  // Check balance
  spinner.start("Checking wallet balance...");
  try {
    const balance = await getWalletBalance(walletAddress, "testnet");
    const formatted = formatBalance(balance);
    spinner.succeed(`Balance: ${chalk.green(formatted.algo)} ALGO, ${chalk.green(formatted.usdc)} USDC`);

    if (balance.algo < 1000000n) {
      console.log(chalk.yellow("\n  ⚠ Low ALGO balance! Get testnet tokens:"));
      console.log(chalk.white("    https://bank.testnet.algorand.network/"));
    }
  } catch (error) {
    spinner.warn("Could not check balance");
  }

  printSection("Payment Preferences");

  const preferredToken = await p.select({
    message: "Preferred Payment Token",
    options: [
      { value: "ALGO", label: "ALGO", hint: "Algorand native token" },
      { value: "USDC", label: "USDC", hint: "USD Coin (stablecoin)" },
    ],
  });

  if (p.isCancel(preferredToken)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  printSection("Registry");

  const registryPath = await p.text({
    message: "Registry Path",
    initialValue: getDefaultRegistryPath(),
    placeholder: "~/.chainpe/registry.json",
  });

  if (p.isCancel(registryPath)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Build and save config (mnemonic already in keychain, NOT in config file)
  spinner.start("Saving configuration...");

  try {
    const config = buildConfig({
      llmMode: mode,
      llmProvider: provider,
      llmModel: llmModel as string,
      llmApiKey: llmApiKey || undefined,
      llmBaseURL: llmBaseURL || undefined,
      walletAddress: walletAddress, // Only address, mnemonic is in keychain
      preferredToken: preferredToken as PaymentToken,
      registryPath: registryPath as string,
      registryAppId: process.env.CHAINPE_REGISTRY_APP_ID || DEFAULT_REGISTRY_APP_ID,
      network: "testnet",
    });

    await saveConfig(config);
    spinner.succeed("Configuration saved!");
  } catch (error) {
    spinner.fail("Failed to save configuration");
    p.cancel("Setup failed");
    process.exit(1);
  }

  // Summary
  console.log();
  console.log(chalk.green.bold("✓ Agent configured with secure keychain storage!"));
  console.log();
  console.log(chalk.gray("  Configuration saved to:"));
  console.log(chalk.white(`    ${getConfigPath()}`));
  console.log();
  console.log(chalk.gray("  Wallet mnemonic stored in:"));
  console.log(chalk.white("    OS Keychain (encrypted, never in plaintext)"));
  console.log();
  console.log(chalk.gray("  Usage in your code:"));
  console.log(chalk.white('    import { ChainPeAgent } from "chainpe-agent";'));
  console.log(chalk.white("    const agent = new ChainPeAgent();"));
  console.log(chalk.white('    const result = await agent.run("Your task here");'));
  console.log();

  p.outro(chalk.green("Ready to use AI services with secure wallet storage!"));
}

// ============================================================================
// Status Command
// ============================================================================

async function runStatus(): Promise<void> {
  printBanner();

  const config = await loadConfig();

  console.log(chalk.cyan.bold("▸ Agent Status"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();

  if (!config) {
    console.log(chalk.yellow("  ⚠ Agent not configured"));
    console.log(chalk.gray(`    Run ${chalk.cyan("chainpe-agent init")} to get started.`));
    console.log();
    return;
  }

  console.log(chalk.gray("  LLM:"));
  console.log(chalk.gray(`    Mode:     ${chalk.white(config.llm.mode || "api")}`));
  console.log(chalk.gray(`    Provider: ${chalk.white(config.llm.provider)}`));
  console.log(chalk.gray(`    Model:    ${chalk.white(config.llm.model)}`));
  if (config.llm.mode === "local") {
    console.log(chalk.gray(`    Base URL: ${chalk.white(config.llm.baseURL || "not set")}`));
  } else {
    console.log(chalk.gray(`    API Key:  ${chalk.green("✓ configured")}`));
  }
  console.log();

  console.log(chalk.gray("  Wallet:"));
  console.log(chalk.gray(`    Address:  ${chalk.cyan(config.wallet.address || "unknown")}`));
  console.log(chalk.gray(`    Network:  ${chalk.yellow(config.network || "testnet")}`));

  // Check keychain status
  if (config.wallet.address) {
    const inKeychain = await hasMnemonic(config.wallet.address);
    if (inKeychain) {
      console.log(chalk.gray(`    Security: ${chalk.green("✓ Stored in OS Keychain (secure)")}`));
    } else {
      const isLegacy = await isLegacyConfig();
      if (isLegacy) {
        console.log(chalk.gray(`    Security: ${chalk.red("⚠ Plaintext storage (INSECURE)")}`));
        console.log(chalk.yellow(`              Run 'chainpe-agent migrate-keychain' to secure`));
      } else {
        console.log(chalk.gray(`    Security: ${chalk.yellow("⚠ Not found in keychain")}`));
      }
    }
  }

  // Check balance
  if (config.wallet.address) {
    const spinner = ora("Checking balance...").start();
    try {
      const balance = await getWalletBalance(config.wallet.address, config.network || "testnet");
      const formatted = formatBalance(balance);
      spinner.stop();
      console.log(chalk.gray(`    ALGO:     ${chalk.green(formatted.algo)}`));
      console.log(chalk.gray(`    USDC:     ${chalk.green(formatted.usdc)}`));
    } catch {
      spinner.stop();
      console.log(chalk.gray(`    Balance:  ${chalk.yellow("(could not fetch)")}`));
    }
  }
  console.log();

  console.log(chalk.gray("  Payment:"));
  console.log(chalk.gray(`    Preferred: ${chalk.white(config.payment.preferredToken)}`));
  console.log();

  // Check on-chain registry
  const registryClient = new RegistryClient((config.network ?? "testnet") as "testnet" | "mainnet");
  console.log(chalk.gray("  Registry:"));
  console.log(chalk.gray(`    Contract: ${chalk.white(`App ID ${registryClient.getAppId()} (Algorand testnet)`)}`));
  console.log();
}

// ============================================================================
// Services Command
// ============================================================================

async function runServices(): Promise<void> {
  printBanner();

  const config = await loadConfig();

  if (!config) {
    console.log(chalk.yellow("  ⚠ Agent not configured"));
    console.log(chalk.gray(`    Run ${chalk.cyan("chainpe-agent init")} to get started.`));
    console.log();
    return;
  }

  console.log(chalk.cyan.bold("▸ Available Services"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();

  const registryClient = new RegistryClient((config.network ?? "testnet") as "testnet" | "mainnet");
  console.log(chalk.gray(`  On-chain registry: App ID ${registryClient.getAppId()} (Algorand testnet)`));
  console.log();
  console.log(chalk.gray("  To discover services, providers must register with: chainpe register"));
  console.log(chalk.gray("  Then use: chainpe-agent run --provider <service-name> --developer <address>"));
  console.log();
}

// ============================================================================
// Migrate Keychain Command
// ============================================================================

async function runMigrateKeychain(): Promise<void> {
  printBanner();

  console.log(chalk.cyan.bold("▸ Migrate to Secure Keychain Storage"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();

  // Check keychain availability
  const keychainAvailable = await isKeychainAvailable();
  if (!keychainAvailable) {
    console.log(chalk.red("  ✗ OS Keychain is not available on this system."));
    console.log(chalk.gray("    Cannot migrate to secure storage."));
    process.exit(1);
  }

  console.log(chalk.green("  ✓ OS Keychain available"));

  // Check for legacy config
  const isLegacy = await isLegacyConfig();
  if (!isLegacy) {
    const config = await loadConfig();
    if (config?.wallet.address) {
      const inKeychain = await hasMnemonic(config.wallet.address);
      if (inKeychain) {
        console.log(chalk.green("  ✓ Wallet is already stored in OS Keychain"));
        console.log(chalk.gray("    No migration needed."));
        return;
      }
    }
    console.log(chalk.yellow("  ⚠ No legacy configuration found to migrate"));
    console.log(chalk.gray("    Run 'chainpe-agent init' to set up your wallet."));
    return;
  }

  console.log(chalk.yellow("  ⚠ Found legacy configuration with plaintext mnemonic"));
  console.log();

  const spinner = ora("Migrating to OS Keychain...").start();

  const result = await migrateToSecureStorage();

  if (result.success) {
    spinner.succeed(chalk.green("Successfully migrated to OS Keychain!"));
    console.log();
    console.log(chalk.gray("  Wallet Address:"));
    console.log(chalk.cyan(`    ${result.address}`));
    console.log();
    console.log(chalk.green("  ✓ Mnemonic removed from config file"));
    console.log(chalk.green("  ✓ Mnemonic stored securely in OS Keychain"));
    console.log();
    console.log(chalk.gray("  Your wallet is now protected by OS-level encryption."));
  } else {
    spinner.fail(chalk.red("Migration failed"));
    console.log(chalk.red(`  Error: ${result.error}`));
    process.exit(1);
  }
}

// ============================================================================
// Security Info Command
// ============================================================================

async function runSecurityInfo(): Promise<void> {
  printBanner();

  console.log(chalk.cyan.bold("▸ Security Information"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();

  // Check keychain status
  const keychainAvailable = await isKeychainAvailable();
  console.log(chalk.gray("  OS Keychain:"));
  if (keychainAvailable) {
    console.log(chalk.green("    ✓ Available and accessible"));
    
    const credInfo = await getCredentialInfo();
    console.log(chalk.gray(`    Stored wallets: ${credInfo.walletCount}`));
    if (credInfo.wallets.length > 0) {
      for (const wallet of credInfo.wallets) {
        console.log(chalk.gray(`      - ${wallet}`));
      }
    }
  } else {
    console.log(chalk.red("    ✗ Not available"));
  }
  console.log();

  // Check config status
  const config = await loadConfig();
  console.log(chalk.gray("  Configuration:"));
  if (config) {
    console.log(chalk.green("    ✓ Config file exists"));
    console.log(chalk.gray(`    Address: ${config.wallet.address || "unknown"}`));
    
    const isLegacy = await isLegacyConfig();
    if (isLegacy) {
      console.log(chalk.red("    ⚠ WARNING: Plaintext mnemonic in config file!"));
      console.log(chalk.yellow("      Run 'chainpe-agent migrate-keychain' to secure"));
    } else {
      console.log(chalk.green("    ✓ No plaintext secrets in config"));
    }
  } else {
    console.log(chalk.yellow("    ⚠ No config file found"));
  }
  console.log();

  // Security recommendations
  console.log(chalk.cyan.bold("▸ Security Recommendations"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();
  console.log(chalk.gray("  1. Use a dedicated 'hot wallet' with limited funds"));
  console.log(chalk.gray("  2. Keep only 10-50 ALGO for agent operations"));
  console.log(chalk.gray("  3. Never share your mnemonic with anyone"));
  console.log(chalk.gray("  4. The OS Keychain is encrypted with your login password"));
  console.log(chalk.gray("  5. Consider spending limits for production (coming soon)"));
  console.log();
}

// ============================================================================
// Run Command
// ============================================================================

async function runTask(task: string, options: { provider?: string; verbose?: boolean }): Promise<void> {
  printBanner();

  const config = await loadConfig();

  if (!config) {
    console.log(chalk.yellow("  ⚠ Agent not configured"));
    console.log(chalk.gray(`    Run ${chalk.cyan("chainpe-agent init")} to get started.`));
    console.log();
    return;
  }

  // Check if wallet is available in keychain
  const mnemonic = await getWalletMnemonic(config.wallet.address);
  if (!mnemonic) {
    console.log(chalk.red("  ✗ Wallet not found in OS Keychain"));
    
    const isLegacy = await isLegacyConfig();
    if (isLegacy) {
      console.log(chalk.yellow("    Found legacy config. Run 'chainpe-agent migrate-keychain' first."));
    } else {
      console.log(chalk.gray("    Run 'chainpe-agent init' to set up your wallet."));
    }
    console.log();
    return;
  }

  console.log(chalk.cyan.bold("▸ Running Task"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();
  console.log(chalk.gray(`  Task: ${chalk.white(task)}`));
  if (options.provider) {
    console.log(chalk.gray(`  Provider: ${chalk.white(options.provider)}`));
  }
  console.log(chalk.gray(`  Wallet: ${chalk.green("✓ Loaded from OS Keychain")}`));
  console.log();

  const spinner = ora("Thinking...").start();

  const agent = new ChainPeAgent({
    config,
    verbose: options.verbose,
  });

  try {
    const result = await agent.run(task, {
      provider: options.provider,
      onStep: (step) => {
        if (step.toolName) {
          spinner.text = `Calling ${step.toolName}...`;
        } else {
          spinner.text = "Thinking...";
        }
      },
      onPayment: (receipt) => {
        console.log(
          chalk.green(`  💰 Paid ${receipt.amount} ${receipt.token} to ${receipt.service}`)
        );
      },
    });

    spinner.stop();

    if (result.success) {
      console.log(chalk.green.bold("✓ Task completed"));
      console.log();
      console.log(chalk.white(result.text));
      console.log();

      if (result.payments.transactionCount > 0) {
        console.log(chalk.gray("  Payments:"));
        console.log(chalk.gray(`    Transactions: ${result.payments.transactionCount}`));
        console.log(chalk.gray(`    Total ALGO:   ${result.payments.totalSpent.ALGO}`));
        console.log(chalk.gray(`    Total USDC:   ${result.payments.totalSpent.USDC}`));
      }

      console.log(chalk.gray(`  Duration: ${result.duration}ms`));
    } else {
      console.log(chalk.red.bold("✗ Task failed"));
      console.log(chalk.red(`  ${result.error}`));
    }
  } catch (error) {
    spinner.fail("Task failed");
    console.log(chalk.red(`  ${(error as Error).message}`));
  }

  console.log();
}

// ============================================================================
// Main CLI
// ============================================================================

program
  .name("chainpe-agent")
  .description("ChainPe Agent — Pre-built AI agent with x402 payments on Algorand (Secure Keychain Storage)")
  .version(VERSION);

program
  .command("init")
  .description("Configure the ChainPe agent (stores wallet in OS keychain)")
  .action(runInit);

program
  .command("status")
  .description("Show agent configuration and security status")
  .action(runStatus);

program
  .command("services")
  .description("List available services in the registry")
  .action(runServices);

program
  .command("migrate-keychain")
  .description("Migrate legacy plaintext wallet to secure OS keychain storage")
  .action(runMigrateKeychain);

program
  .command("security")
  .description("Show security information and recommendations")
  .action(runSecurityInfo);

program
  .command("run <task>")
  .description("Run a task with the agent")
  .option("-p, --provider <name>", "Specify a service provider to use")
  .option("-v, --verbose", "Enable verbose output")
  .action(runTask);

program.parse();
