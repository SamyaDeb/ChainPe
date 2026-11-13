#!/usr/bin/env node

/**
 * ChainPe Agent CLI
 * Terminal interface for configuring the AI agent (Avalanche C-Chain).
 *
 * SECURITY: Wallet private keys are stored in the OS keychain (macOS Keychain,
 * Linux Secret Service, Windows Credential Manager), never in plaintext files.
 */

import { program } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import gradient from "gradient-string";
import ora from "ora";
import { generatePrivateKey } from "viem/accounts";

import type { LLMProvider, PaymentToken, LLMMode, ChainPeNetwork } from "./types.js";
import {
  loadConfig,
  saveConfig,
  buildConfig,
  isValidPrivateKey,
  addressFromPrivateKey,
  DEFAULT_MODELS,
  getConfigPath,
  getDefaultRegistryPath,
  saveWalletToKeychain,
  getWalletPrivateKey,
} from "./config.js";
import { getWalletBalance, formatBalance } from "./wallet.js";
import { RegistryClient } from "./registry.js";
import { ChainPeAgent } from "./agent.js";
import { isKeychainAvailable, hasPrivateKey, getCredentialInfo } from "./keychain.js";

const VERSION = "2.0.0";

const agentGradient = gradient(["#E84142", "#FF6B6B", "#FFD93D"]);

// ============================================================================
// Banner & styling
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
  console.log(chalk.gray("  Pre-built AI Agent with x402 USDC Payments on Avalanche"));
  console.log();
}

function printSection(title: string): void {
  console.log();
  console.log(chalk.cyan.bold(`▸ ${title}`));
  console.log(chalk.gray("─".repeat(50)));
}

function shortAddr(addr: string): string {
  return `${chalk.cyan(addr.slice(0, 6))}…${chalk.cyan(addr.slice(-4))}`;
}

// ============================================================================
// Validation
// ============================================================================

function validateApiKey(value: string | undefined): string | undefined {
  if (!value || value.length < 10) return "Please enter a valid API key";
  return undefined;
}

function validatePrivateKeyInput(value: string | undefined): string | undefined {
  if (!value) return "Private key is required";
  if (!isValidPrivateKey(value)) return "Please enter a valid private key (0x + 64 hex)";
  return undefined;
}

// ============================================================================
// init
// ============================================================================

async function runInit(): Promise<void> {
  printBanner();
  p.intro(chalk.bgRed.white(" ChainPe Agent Setup "));

  const keychainAvailable = await isKeychainAvailable();
  if (!keychainAvailable) {
    console.log(chalk.red("\n  ⚠ OS Keychain is not available on this system."));
    console.log(chalk.yellow("    Your wallet key cannot be stored securely."));
    p.cancel("Setup failed - keychain unavailable");
    process.exit(1);
  }
  console.log(chalk.green("\n  ✓ OS Keychain available - your wallet will be stored securely"));

  const existing = await loadConfig();
  if (existing) {
    const overwrite = await prompt(
      p.confirm({ message: "Configuration already exists. Overwrite?", initialValue: false })
    );
    if (!overwrite) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
  }

  printSection("LLM Configuration");

  const mode = (await prompt(
    p.select({
      message: "LLM Mode",
      options: [
        { value: "local", label: "Local (Ollama)", hint: "Free, runs on your machine" },
        { value: "api", label: "API (OpenAI/Anthropic/Gemini/Groq)", hint: "Cloud-based, requires API key" },
      ],
    })
  )) as LLMMode;

  let provider: LLMProvider = "openai";
  let llmModel = "";
  let llmApiKey = "";
  let llmBaseURL = "";

  if (mode === "local") {
    console.log(chalk.gray("\n  Using Ollama (OpenAI-compatible endpoint)."));
    provider = "openai";
    llmBaseURL = (await prompt(
      p.text({ message: "Ollama Base URL", initialValue: "http://localhost:11434/v1" })
    )) as string;
    llmModel = (await prompt(p.text({ message: "Model Name", initialValue: "qwen2.5:7b" }))) as string;
    llmApiKey = "ollama";
  } else {
    provider = (await prompt(
      p.select({
        message: "LLM Provider",
        options: [
          { value: "groq", label: "Groq", hint: "fast inference" },
          { value: "openai", label: "OpenAI" },
          { value: "anthropic", label: "Anthropic" },
          { value: "gemini", label: "Google Gemini" },
        ],
      })
    )) as LLMProvider;

    llmModel = (await prompt(
      p.select({
        message: "Model",
        options: DEFAULT_MODELS[provider].map((m, i) => ({
          value: m,
          label: m,
          hint: i === 0 ? "recommended" : undefined,
        })),
      })
    )) as string;

    llmApiKey = (await prompt(
      p.password({ message: `${provider} API Key`, validate: validateApiKey })
    )) as string;
  }

  printSection("Network");
  const network = (await prompt(
    p.select({
      message: "Avalanche network",
      options: [
        { value: "fuji", label: "Fuji (testnet)", hint: "recommended" },
        { value: "avalanche", label: "Avalanche (mainnet)" },
      ],
    })
  )) as ChainPeNetwork;

  printSection("Wallet Configuration (Secure Storage)");
  console.log(chalk.gray("  Your wallet private key is stored in the OS keychain, NEVER in files."));
  console.log(chalk.gray("  Get Fuji funds: https://faucet.avax.network/ (AVAX) · https://faucet.circle.com (USDC)"));
  console.log();

  const walletMode = await prompt(
    p.select({
      message: "Wallet",
      options: [
        { value: "import", label: "Import an existing private key" },
        { value: "generate", label: "Generate a new wallet" },
      ],
    })
  );

  let privateKey: string;
  if (walletMode === "generate") {
    privateKey = generatePrivateKey();
    console.log(chalk.yellow("\n  ⚠ New wallet generated. Back up this private key securely:"));
    console.log(chalk.white(`    ${privateKey}`));
    console.log();
  } else {
    privateKey = (await prompt(
      p.password({ message: "Wallet private key (0x…)", validate: validatePrivateKeyInput })
    )) as string;
    if (!privateKey.startsWith("0x")) privateKey = `0x${privateKey}`;
  }

  const spinner = ora("Validating wallet…").start();
  let walletAddress: string;
  try {
    walletAddress = addressFromPrivateKey(privateKey);
    spinner.succeed(`Wallet: ${shortAddr(walletAddress)}`);
  } catch {
    spinner.fail("Invalid private key");
    p.cancel("Setup failed");
    process.exit(1);
  }

  spinner.start("Storing wallet in OS keychain…");
  try {
    await saveWalletToKeychain(walletAddress, privateKey);
    spinner.succeed(chalk.green("Wallet securely stored in OS keychain"));
  } catch (error) {
    spinner.fail("Failed to store wallet in keychain");
    console.log(chalk.red(`  Error: ${(error as Error).message}`));
    p.cancel("Setup failed");
    process.exit(1);
  }

  spinner.start("Checking wallet balance…");
  try {
    const balance = await getWalletBalance(walletAddress, network);
    const fmt = formatBalance(balance);
    spinner.succeed(`Balance: ${chalk.green(fmt.avax)} AVAX, ${chalk.green(fmt.usdc)} USDC`);
  } catch {
    spinner.warn("Could not check balance");
  }

  printSection("Registry");
  const registryAddress = (await prompt(
    p.text({
      message: "ChainPe Registry contract address (optional)",
      placeholder: "0x… (leave blank to set later)",
      defaultValue: "",
    })
  )) as string;

  const registryPath = (await prompt(
    p.text({ message: "Local registry cache path", initialValue: getDefaultRegistryPath() })
  )) as string;

  spinner.start("Saving configuration…");
  try {
    const config = buildConfig({
      llmMode: mode,
      llmProvider: provider,
      llmModel,
      llmApiKey: llmApiKey || undefined,
      llmBaseURL: llmBaseURL || undefined,
      walletAddress,
      preferredToken: "USDC" as PaymentToken,
      registryPath,
      registryAddress: (registryAddress as string) || process.env.CHAINPE_REGISTRY_ADDRESS,
      network,
    });
    await saveConfig(config);
    spinner.succeed("Configuration saved!");
  } catch {
    spinner.fail("Failed to save configuration");
    p.cancel("Setup failed");
    process.exit(1);
  }

  console.log();
  console.log(chalk.green.bold("✓ Agent configured with secure keychain storage!"));
  console.log(chalk.gray(`  Config: ${getConfigPath()}`));
  console.log(chalk.gray("  Private key: OS Keychain (encrypted)"));
  console.log();
  console.log(chalk.gray("  Usage:"));
  console.log(chalk.white('    import { ChainPeAgent } from "@chainpe/agent";'));
  console.log(chalk.white("    const agent = new ChainPeAgent();"));
  console.log(chalk.white('    const result = await agent.run("Your task here");'));
  console.log();
  p.outro(chalk.green("Ready to use paid AI services on Avalanche!"));
}

// ============================================================================
// status
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
  console.log();

  console.log(chalk.gray("  Wallet:"));
  console.log(chalk.gray(`    Address:  ${chalk.cyan(config.wallet.address || "unknown")}`));
  console.log(chalk.gray(`    Network:  ${chalk.yellow(config.network || "fuji")}`));

  if (config.wallet.address) {
    const inKeychain = await hasPrivateKey(config.wallet.address);
    console.log(
      chalk.gray(
        `    Security: ${inKeychain ? chalk.green("✓ Stored in OS Keychain") : chalk.yellow("⚠ Not found in keychain")}`
      )
    );

    const spinner = ora("Checking balance…").start();
    try {
      const balance = await getWalletBalance(config.wallet.address, config.network || "fuji");
      const fmt = formatBalance(balance);
      spinner.stop();
      console.log(chalk.gray(`    AVAX:     ${chalk.green(fmt.avax)}`));
      console.log(chalk.gray(`    USDC:     ${chalk.green(fmt.usdc)}`));
    } catch {
      spinner.stop();
      console.log(chalk.gray(`    Balance:  ${chalk.yellow("(could not fetch)")}`));
    }
  }
  console.log();

  console.log(chalk.gray("  Payment:"));
  console.log(chalk.gray(`    Token:    ${chalk.white(config.payment.preferredToken)}`));
  console.log();

  console.log(chalk.gray("  Registry:"));
  const registryAddr = config.registryAddress || process.env.CHAINPE_REGISTRY_ADDRESS;
  console.log(
    chalk.gray(
      `    Contract: ${registryAddr ? chalk.white(registryAddr) : chalk.yellow("not set — deploy & set registryAddress")}`
    )
  );
  console.log();
}

// ============================================================================
// services
// ============================================================================

async function runServices(): Promise<void> {
  printBanner();
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.yellow("  ⚠ Agent not configured. Run chainpe-agent init.\n"));
    return;
  }

  console.log(chalk.cyan.bold("▸ Available Services"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();

  const registryAddr = config.registryAddress || process.env.CHAINPE_REGISTRY_ADDRESS;
  if (!registryAddr) {
    console.log(chalk.yellow("  ⚠ Registry address not set."));
    console.log(chalk.gray("    Set registryAddress in ~/.chainpe/agent.json or CHAINPE_REGISTRY_ADDRESS.\n"));
    return;
  }

  const spinner = ora("Fetching services from the on-chain registry…").start();
  try {
    const client = new RegistryClient(config.network || "fuji", registryAddr);
    const services = await client.listAllServices();
    spinner.stop();
    if (services.length === 0) {
      console.log(chalk.gray("  No services registered yet.\n"));
      return;
    }
    for (const s of services) {
      console.log(chalk.white.bold(`  ${s.name}`));
      console.log(chalk.gray(`    ${s.description}`));
      console.log(chalk.gray(`    Price: ${chalk.green(s.pricePerRequest)} ${s.paymentToken}  ·  ${s.endpoint}`));
      if (s.agentId) console.log(chalk.gray(`    Agent ID: ${s.agentId} (ERC-8004)`));
      console.log();
    }
    console.log(chalk.gray(`  Registry: ${client.getAddress()}\n`));
  } catch (error) {
    spinner.fail("Could not fetch services");
    console.log(chalk.red(`  ${(error as Error).message}\n`));
  }
}

// ============================================================================
// security
// ============================================================================

async function runSecurityInfo(): Promise<void> {
  printBanner();
  console.log(chalk.cyan.bold("▸ Security Information"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();

  const keychainAvailable = await isKeychainAvailable();
  console.log(chalk.gray("  OS Keychain:"));
  if (keychainAvailable) {
    console.log(chalk.green("    ✓ Available and accessible"));
    const credInfo = await getCredentialInfo();
    console.log(chalk.gray(`    Stored wallets: ${credInfo.walletCount}`));
    for (const wallet of credInfo.wallets) console.log(chalk.gray(`      - ${wallet}`));
  } else {
    console.log(chalk.red("    ✗ Not available"));
  }
  console.log();

  console.log(chalk.cyan.bold("▸ Recommendations"));
  console.log(chalk.gray("─".repeat(50)));
  console.log(chalk.gray("  1. Use a dedicated hot wallet with limited funds"));
  console.log(chalk.gray("  2. Keep only enough USDC/AVAX for agent operations"));
  console.log(chalk.gray("  3. Never share your private key"));
  console.log(chalk.gray("  4. The OS Keychain is encrypted with your login password"));
  console.log();
}

// ============================================================================
// run
// ============================================================================

async function runTask(task: string, options: { provider?: string; verbose?: boolean }): Promise<void> {
  printBanner();
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.yellow("  ⚠ Agent not configured. Run chainpe-agent init.\n"));
    return;
  }

  const privateKey = await getWalletPrivateKey(config.wallet.address);
  if (!privateKey) {
    console.log(chalk.red("  ✗ Wallet not found in OS Keychain"));
    console.log(chalk.gray("    Run 'chainpe-agent init' to set up your wallet.\n"));
    return;
  }

  console.log(chalk.cyan.bold("▸ Running Task"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();
  console.log(chalk.gray(`  Task: ${chalk.white(task)}`));
  if (options.provider) console.log(chalk.gray(`  Provider: ${chalk.white(options.provider)}`));
  console.log(chalk.gray(`  Wallet: ${chalk.green("✓ Loaded from OS Keychain")}`));
  console.log();

  const spinner = ora("Thinking…").start();
  const agent = new ChainPeAgent({ config, verbose: options.verbose });

  try {
    const result = await agent.run(task, {
      provider: options.provider,
      onStep: (step) => {
        spinner.text = step.toolName ? `Calling ${step.toolName}…` : "Thinking…";
      },
      onPayment: (receipt) => {
        console.log(chalk.green(`  💰 Paid ${receipt.amount} ${receipt.token} to ${receipt.service}`));
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
// helpers
// ============================================================================

async function prompt<T>(thenable: Promise<T | symbol>): Promise<T> {
  const value = await thenable;
  if (p.isCancel(value)) {
    p.cancel("Cancelled");
    process.exit(0);
  }
  return value as T;
}

// ============================================================================
// Main
// ============================================================================

program
  .name("chainpe-agent")
  .description("ChainPe Agent — Pre-built AI agent with x402 USDC payments on Avalanche")
  .version(VERSION);

program.command("init").description("Configure the agent (stores wallet in OS keychain)").action(runInit);
program.command("status").description("Show agent configuration and status").action(runStatus);
program.command("services").description("List services registered on-chain").action(runServices);
program.command("security").description("Show security information and recommendations").action(runSecurityInfo);
program
  .command("run <task>")
  .description("Run a task with the agent")
  .option("-p, --provider <name>", "Specify a service provider to use")
  .option("-v, --verbose", "Enable verbose output")
  .action(runTask);

program.parse();
