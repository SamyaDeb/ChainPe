#!/usr/bin/env node

/**
 * ChainPe Agent CLI
 * Terminal interface for the AI agent on Arc.
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
  saveWalletToKeychain,
  getWalletPrivateKey,
} from "./config.js";
import { getWalletBalance, formatBalance } from "./wallet.js";
import { formatServiceForDisplay } from "./tools/index.js";
import { discoverServices } from "@chainpearc/sdk";
import { ChainPeAgent } from "./agent.js";
import { isKeychainAvailable, hasPrivateKey, getCredentialInfo } from "./keychain.js";

const VERSION = "3.1.0";

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
  console.log(chalk.gray("  An AI agent that pays for APIs per call, in USDC on Arc"));
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

function validateUsdc(value: string | undefined): string | undefined {
  if (!value || !/^\d+(\.\d{1,6})?$/.test(value) || Number(value) <= 0) return "Enter a positive USDC amount, e.g. 0.10";
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

  // Mainnet takes real USDC and is not tested yet, so the wizard only sets up testnet.
  const network: ChainPeNetwork = "arc-testnet";

  printSection("Wallet Configuration (Secure Storage)");
  console.log(chalk.gray("  Your wallet private key is stored in the OS keychain, NEVER in files."));
  console.log(chalk.gray("  Use a new wallet just for the agent. Get free test USDC at https://faucet.circle.com (pick Arc Testnet)."));
  console.log(chalk.gray("  On Arc, the same USDC also pays for gas."));
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
    const fmt = formatBalance(await getWalletBalance(walletAddress, network, privateKey));
    spinner.succeed(`Balance: ${chalk.green(fmt.usdc)} USDC, ${chalk.green(fmt.gateway ?? "0")} USDC in Gateway`);
  } catch {
    spinner.warn("Could not check balance");
  }

  printSection("Spending limits");
  const maxPricePerRequest = (await prompt(
    p.text({ message: "Most USDC to pay for one call", initialValue: "0.10", validate: validateUsdc })
  )) as string;
  const maxPerRun = (await prompt(
    p.text({ message: "Most USDC to spend on one task", initialValue: "1.00", validate: validateUsdc })
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
      maxPricePerRequest,
      maxPerRun,
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
  console.log(chalk.white('    import { ChainPeAgent } from "@chainpearc/agent";'));
  console.log(chalk.white("    const agent = new ChainPeAgent();"));
  console.log(chalk.white('    const result = await agent.run("Your task here");'));
  console.log();
  p.outro(chalk.green(`Ready. Try: chainpe-agent run "What is the weather in Mumbai?"`));
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
  console.log(chalk.gray(`    Network:  ${chalk.yellow(config.network || "arc-testnet")}`));

  if (config.wallet.address) {
    const inKeychain = await hasPrivateKey(config.wallet.address);
    console.log(
      chalk.gray(
        `    Security: ${inKeychain ? chalk.green("✓ Stored in OS Keychain") : chalk.yellow("⚠ Not found in keychain")}`
      )
    );

    const spinner = ora("Checking balance…").start();
    try {
      const key = (await getWalletPrivateKey(config.wallet.address)) ?? undefined;
      const fmt = formatBalance(await getWalletBalance(config.wallet.address, config.network || "arc-testnet", key));
      spinner.stop();
      console.log(chalk.gray(`    USDC:     ${chalk.green(fmt.usdc)} (also pays gas)`));
      if (fmt.gateway !== undefined) console.log(chalk.gray(`    Gateway:  ${chalk.green(fmt.gateway)} USDC`));
    } catch {
      spinner.stop();
      console.log(chalk.gray(`    Balance:  ${chalk.yellow("(could not fetch)")}`));
    }
  }
  console.log();

  console.log(chalk.gray("  Spending limits:"));
  console.log(chalk.gray(`    Per call: ${chalk.white(config.payment.maxPricePerRequest ?? "0.10")} USDC`));
  console.log(chalk.gray(`    Per task: ${chalk.white(config.payment.maxPerRun ?? "1.00")} USDC`));
  console.log();
}

// ============================================================================
// services
// ============================================================================

async function runServices(query: string | undefined): Promise<void> {
  printBanner();
  const config = await loadConfig();
  const network = config?.network ?? "arc-testnet";

  console.log(chalk.cyan.bold(`▸ Services on ${network}${query ? ` matching "${query}"` : ""}`));
  console.log(chalk.gray("─".repeat(50)));
  console.log();

  const spinner = ora("Searching Circle's Discovery API and ChainPeAccounts…").start();
  try {
    const services = await discoverServices(network, { query, limit: 15 }, {
      accountsAddress: config?.accountsAddress,
      reputationRegistry: config?.reputationRegistry,
    });
    spinner.stop();
    if (services.length === 0) {
      console.log(chalk.gray("  No services found.\n"));
      return;
    }
    for (const service of services.map(formatServiceForDisplay)) {
      console.log(chalk.white.bold(`  ${service.name}`));
      if (service.description) console.log(chalk.gray(`    ${service.description}`));
      console.log(chalk.gray(`    Price: ${chalk.green(service.price)}, by ${service.rails.join(" or ")}${service.rating ? `  ·  ⭐ ${service.rating}` : ""}`));
      console.log(chalk.gray(`    ${service.method ? `${service.method} ` : ""}${service.url}`));
      console.log();
    }
  } catch (error) {
    spinner.fail("Could not search for services");
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
  console.log(chalk.gray("  2. Keep only enough USDC for the agent's tasks, and set low spending limits"));
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
        console.log(chalk.green(`  💰 Paid ${receipt.amount} ${receipt.token} to ${receipt.service} (${receipt.rail})`));
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
  .description("ChainPe Agent: an AI agent that pays for APIs per call, in USDC on Arc")
  .version(VERSION);

program.command("init").description("Configure the agent (stores wallet in OS keychain)").action(runInit);
program.command("status").description("Show agent configuration and status").action(runStatus);
program.command("services [query]").description("Find paid services on Arc").action(runServices);
program.command("security").description("Show security information and recommendations").action(runSecurityInfo);
program
  .command("run <task>")
  .description("Run a task with the agent")
  .option("-p, --provider <name>", "Specify a service provider to use")
  .option("-v, --verbose", "Enable verbose output")
  .action(runTask);

program.parse();
