#!/usr/bin/env node

/**
 * ChainPe CLI
 * Terminal interface for the x402 payment gateway on Arc.
 */

import "dotenv/config";
import { program } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import gradient from "gradient-string";
import ora from "ora";

import type { ChainPeConfig, ChainPeNetwork } from "./types.js";
import { isValidAddress, getUsdcBalance, formatUsdc } from "./evm.js";
import { getNetwork, parseNetwork } from "./chains.js";
import {
  ALL_RAILS,
  assertExactSupported,
  createCircleFacilitator,
  createGateway,
  facilitatorMode,
  parseRails,
  RailRouter,
  startProxyServer,
  resolveSellerKey,
} from "./proxy/index.js";
import { setLogLevel } from "./logger.js";
import { configPath, loadConfig, saveConfig } from "./config.js";
import { documentPaths } from "./doctor/documents.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runLoginCommand, runLogoutCommand } from "./commands/cloud.js";
import { startTelemetry } from "./cloud/start.js";
import { VERSION } from "./version.js";
import { gatewayClient, runFetchCommand, runDiscoverCommand, runDepositCommand } from "./commands/consume.js";
import { runBalanceCommand, runWithdrawCommand } from "./commands/seller.js";
import {
  runDeregisterCommand,
  runIdentityCommand,
  runListCommand,
  runPlanCommand,
  runRegisterCommand,
  runUpgradeCommand,
} from "./commands/provider.js";

// ============================================================================
// Constants
// ============================================================================


const chainpeGradient = gradient(["#E84142", "#FF6B6B", "#FFD93D"]);

// ============================================================================
// Banner & styling
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
  console.log(chalk.gray("  API Marketplace on Arc • x402 Micropayments"));
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
  if (isNaN(num) || num <= 0) return "Please enter a valid positive number";
  return undefined;
}

function validatePort(value: string | undefined): string | undefined {
  if (!value) return "Port is required";
  const port = parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) return "Please enter a valid port (1-65535)";
  return undefined;
}

function validateWalletAddress(value: string | undefined): string | undefined {
  if (!value) return "Wallet address is required";
  if (!isValidAddress(value)) return "Please enter a valid EVM address (0x + 40 hex)";
  return undefined;
}

// ============================================================================
// init
// ============================================================================

async function runInit(): Promise<void> {
  printBanner();
  p.intro(chalk.bgRed.white(" ChainPe Setup "));

  const existing = await loadConfig();
  if (existing) {
    const overwrite = await p.confirm({ message: "Configuration already exists. Overwrite?", initialValue: false });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
  }

  printSection("Service Configuration");

  const targetUrl = await prompt(p.text({ message: "Your API URL (the backend ChainPe will proxy)", placeholder: "http://localhost:3000", validate: validateUrl }));
  const publicUrl = await prompt(p.text({ message: "Public HTTPS URL of this proxy, published on-chain. Never your backend. Leave empty if not deployed yet", placeholder: "https://api.example.com" }));
  const serviceName = await prompt(p.text({ message: "Service name (for registry listing)", placeholder: "My AI Agent API", validate: (v) => (!v || v.length < 3 ? "Name must be at least 3 characters" : undefined) }));
  const serviceDescription = await prompt(p.text({ message: "Service description", placeholder: "AI-powered research assistant", validate: (v) => (!v || v.length < 10 ? "Description must be at least 10 characters" : undefined) }));
  const tags = await prompt(p.text({ message: "Tags (comma-separated, for discovery)", placeholder: "ai, research, documents" }));

  printSection("Pricing");
  const pricePerRequest = await prompt(p.text({ message: "Price per request (USDC)", placeholder: "0.01", validate: validatePrice }));

  printSection("Network & Wallet");
  const network = (await prompt(
    p.select({
      message: "Arc network",
      options: [
        { value: "arc-testnet", label: "Arc Testnet", hint: "recommended for testing" },
        { value: "arc", label: "Arc (mainnet)" },
      ],
    })
  )) as ChainPeNetwork;

  console.log(chalk.gray("\n  Your wallet address receives all payments. `chainpe start` needs its key in CHAINPE_SELLER_PRIVATE_KEY.\n"));
  const walletAddress = (await prompt(p.text({ message: "Your Arc wallet address (0x…, receives payments)", placeholder: "0x…", validate: validateWalletAddress }))) as string;

  const spinner = ora("Validating wallet address…").start();
  try {
    const usdc = await getUsdcBalance(network, walletAddress);
    spinner.succeed(`Wallet verified! Balance: ${chalk.green(formatUsdc(usdc))} USDC`);
  } catch {
    spinner.succeed(`Wallet address accepted: ${shortAddr(walletAddress)}`);
  }

  printSection("Server Configuration");
  const proxyPort = await prompt(p.text({ message: "Proxy port", placeholder: "4402", initialValue: "4402", validate: validatePort }));

  const config: ChainPeConfig = {
    serviceName: serviceName as string,
    serviceDescription: serviceDescription as string,
    tags: (tags as string).split(",").map((t) => t.trim()).filter(Boolean),
    targetUrl: targetUrl as string,
    ...(publicUrl ? { publicUrl: publicUrl as string } : {}),
    pricePerRequest: pricePerRequest as string,
    paymentToken: "USDC",
    walletAddress: walletAddress,
    proxyPort: parseInt(proxyPort as string, 10),
    network,
    logLevel: "normal",
  };

  const s2 = ora("Saving configuration…").start();
  try {
    await saveConfig(config);
    s2.succeed("Configuration saved!");
  } catch {
    s2.fail("Failed to save configuration");
    process.exit(1);
  }

  console.log();
  console.log(chalk.green.bold("✓ Configuration complete!"));
  console.log(chalk.gray(`    Target:   ${chalk.white(config.targetUrl)}`));
  console.log(chalk.gray(`    Price:    ${chalk.green(config.pricePerRequest)} USDC per request`));
  console.log(chalk.gray(`    Payments: ${shortAddr(config.walletAddress)} on ${chalk.yellow(config.network)}`));
  console.log();
  console.log(chalk.gray(`  Start the gateway:  ${chalk.cyan("chainpe start")}`));
  console.log();
  p.outro(chalk.green("Setup complete! 🚀"));
}

// ============================================================================
// start
// ============================================================================

async function runStart(options: {
  port?: string;
  verbose?: boolean;
  network?: string;
  facilitatorUrl?: string;
  rails?: string;
  telemetry?: boolean;
}): Promise<void> {
  printBanner();
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red("✗ No configuration found."));
    console.log(chalk.gray(`  Run ${chalk.cyan("chainpe init")} first.`));
    process.exit(1);
  }

  if (options.port) config.proxyPort = parseInt(options.port, 10);
  setLogLevel(options.verbose ? "verbose" : config.logLevel ?? "normal");

  try {
    config.network = resolveNetwork(options.network, config);
    const info = getNetwork(config.network);
    const rails = options.rails ? parseRails(options.rails) : (config.rails ?? ALL_RAILS);
    config.rails = rails;

    const exact = rails.includes("exact") ? createCircleFacilitator(config, { url: options.facilitatorUrl }) : undefined;
    if (exact) await assertExactSupported(exact, info.caip2);
    const gateway = rails.includes("gateway") ? await createGateway(config.network) : undefined;
    const facilitator = new RailRouter({ exact, gateway: gateway?.guard });

    console.log(chalk.gray("  Starting x402 payment gateway…\n"));
    console.log(chalk.gray("  Configuration:"));
    console.log(chalk.gray(`    Service:     ${chalk.white(config.serviceName)}`));
    console.log(chalk.gray(`    Target:      ${chalk.white(config.targetUrl)}`));
    console.log(chalk.gray(`    Public URL:  ${chalk.white(config.publicUrl ?? "(not set)")}`));
    console.log(chalk.gray(`    Price:       ${chalk.green(config.pricePerRequest)} USDC`));
    console.log(chalk.gray(`    Wallet:      ${shortAddr(config.walletAddress)}`));
    console.log(chalk.gray(`    Network:     ${chalk.yellow(config.network)} (${info.caip2})`));
    console.log(chalk.gray(`    Rails:       ${chalk.green(rails.join(", "))}`));
    if (exact) console.log(chalk.gray(`    Facilitator: ${chalk.green(facilitatorMode())}`));
    console.log();

    const documents = documentPaths(configPath());
    const telemetry = await startTelemetry({
      enabled: options.telemetry !== false,
      config,
      network: config.network,
      version: VERSION,
      doctorFile: documents.doctor,
      gatewayClient: rails.includes("gateway") ? () => gatewayClient(info.name, resolveSellerKey(config.walletAddress)) : undefined,
    });
    console.log(chalk.gray(`    Telemetry:   ${telemetry ? chalk.green(telemetry.cloudUrl) : "off"}\n`));

    await startProxyServer({ config, facilitator, gateway: gateway?.terms, documents, onPayment: telemetry?.onPayment });
    console.log(chalk.gray("  Press Ctrl+C to stop\n"));
    const shutdown = (): void => {
      console.log(chalk.yellow("\n  Shutting down…"));
      telemetry?.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.log(chalk.red(`✗ Failed to start server: ${(error as Error).message}`));
    process.exit(1);
  }
}

// ============================================================================
// status
// ============================================================================

async function runStatus(options: { network?: string }): Promise<void> {
  printBanner();
  const config = await loadConfig();
  console.log(chalk.cyan.bold("▸ ChainPe Status"));
  console.log(chalk.gray("─".repeat(50)));
  console.log();

  if (!config) {
    console.log(chalk.yellow("  ⚠ Not configured"));
    console.log(chalk.gray(`    Run ${chalk.cyan("chainpe init")} to get started.\n`));
    return;
  }

  let network: ChainPeNetwork;
  try {
    network = resolveNetwork(options.network, config);
  } catch (error) {
    console.log(chalk.red(`  ✗ ${(error as Error).message}\n`));
    process.exit(1);
  }
  const info = getNetwork(network);

  console.log(chalk.gray("  Configuration:"));
  console.log(chalk.gray(`    Service:     ${chalk.white(config.serviceName)}`));
  console.log(chalk.gray(`    Target:      ${chalk.white(config.targetUrl)}`));
  console.log(chalk.gray(`    Price:       ${chalk.green(config.pricePerRequest)} USDC`));
  console.log();
  console.log(chalk.gray("  Network:"));
  console.log(chalk.gray(`    Network:     ${chalk.yellow(network)}`));
  console.log(chalk.gray(`    Chain ID:    ${chalk.white(info.chainId)}`));
  console.log(chalk.gray(`    CAIP-2:      ${chalk.white(info.caip2)}`));
  console.log(chalk.gray(`    Gas token:   ${chalk.white(info.gasToken)}`));
  console.log(chalk.gray(`    Rails:       ${chalk.green((config.rails ?? ALL_RAILS).join(", "))}`));
  console.log(chalk.gray(`    Facilitator: ${chalk.green(facilitatorMode())}`));
  console.log();
  console.log(chalk.gray("  Wallet (receives payments):"));
  console.log(chalk.gray(`    payTo:       ${chalk.cyan(config.walletAddress)}`));

  const spinner = ora("Checking balance…").start();
  try {
    const usdc = await getUsdcBalance(network, config.walletAddress);
    spinner.stop();
    console.log(chalk.gray(`    Balance:     ${chalk.green(formatUsdc(usdc))} USDC (also pays gas)`));
  } catch {
    spinner.stop();
    console.log(chalk.gray(`    Balance:     ${chalk.yellow("(could not fetch)")}`));
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

/** --network, then CHAINPE_NETWORK, then the saved config. */
function resolveNetwork(explicit: string | undefined, config: ChainPeConfig): ChainPeNetwork {
  return parseNetwork(explicit ?? process.env.CHAINPE_NETWORK ?? config.network);
}

/** Loads what a seller money command needs, or exits. */
async function sellerContext(networkOption?: string): Promise<{ walletAddress: string; network: ChainPeNetwork }> {
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red("✗ No configuration found."));
    console.log(chalk.gray(`  Run ${chalk.cyan("chainpe init")} first.`));
    process.exit(1);
  }
  try {
    return { walletAddress: config.walletAddress, network: resolveNetwork(networkOption, config) };
  } catch (error) {
    console.log(chalk.red(`✗ ${(error as Error).message}`));
    process.exit(1);
  }
}

function shortAddr(addr: string): string {
  return `${chalk.cyan(addr.slice(0, 6))}…${chalk.cyan(addr.slice(-4))}`;
}

// ============================================================================
// Main
// ============================================================================

program
  .name("chainpe")
  .description("ChainPe — Monetize any API with x402 micropayments on Arc")
  .version(VERSION);

program.command("init").description("Initialize a new ChainPe configuration").action(runInit);
program
  .command("start")
  .description("Start the x402 payment proxy")
  .option("-p, --port <port>", "Override the proxy port")
  .option("-v, --verbose", "Enable verbose logging")
  .option("-n, --network <network>", "arc | arc-testnet (default: $CHAINPE_NETWORK, then config)")
  .option("--facilitator-url <url>", "Override the Circle facilitator URL (advanced)")
  .option("--rails <rails>", "Payment rails to accept: exact,gateway (default: config, then both)")
  .option("--no-telemetry", "Send nothing to chainpe-cloud")
  .action(runStart);
program
  .command("login")
  .description("Sign in to chainpe-cloud with the seller key and save an ingest key")
  .option("--cloud-url <url>", "chainpe-cloud URL (default: $CHAINPE_CLOUD_URL, then the saved one)")
  .option("-n, --network <network>", "arc | arc-testnet (default: $CHAINPE_NETWORK, then config)")
  .action(runLoginCommand);
program
  .command("logout")
  .description("Remove the ingest key from this machine and revoke it")
  .option("-n, --network <network>", "arc | arc-testnet (default: $CHAINPE_NETWORK, then config)")
  .action(runLogoutCommand);
const NETWORK_FLAG = "arc | arc-testnet (default: $CHAINPE_NETWORK, then config)";
program
  .command("identity")
  .description("Find or mint this wallet's ERC-8004 identity")
  .option("-n, --network <network>", NETWORK_FLAG)
  .option("--agent-id <id>", "Use this agentId, which the wallet must own")
  .option("--update-uri", "Point the token's URI at this service's agent card")
  .option("--new", "Mint another identity even if the wallet already has one")
  .option("--allow-http", "Allow an http publicUrl (arc-testnet only)")
  .action(runIdentityCommand);
program
  .command("register")
  .description("Create or update your provider account and service on ChainPeAccounts")
  .option("-n, --network <network>", NETWORK_FLAG)
  .option("--allow-http", "Allow an http publicUrl (arc-testnet only)")
  .action(runRegisterCommand);
program
  .command("deregister")
  .description("Deactivate a service. Its history stays on-chain")
  .option("-n, --network <network>", NETWORK_FLAG)
  .option("--name <name>", "Service name (default: the one in your config)")
  .action(runDeregisterCommand);
program
  .command("list")
  .description("List services registered on ChainPeAccounts")
  .option("-n, --network <network>", NETWORK_FLAG)
  .option("--mine", "Only this wallet's services")
  .option("--all", "Include inactive services")
  .option("--json", "Print JSON")
  .action(runListCommand);
program
  .command("plan")
  .description("Show your plan, paid-until date and service limit")
  .option("-n, --network <network>", NETWORK_FLAG)
  .action(runPlanCommand);
program
  .command("upgrade")
  .description("Pay for Pro in USDC. Approves exactly the amount")
  .option("-n, --network <network>", NETWORK_FLAG)
  .option("--periods <n>", "30-day periods to buy, 1 to 12 (default 1)")
  .option("-y, --yes", "Do not ask for confirmation")
  .action(runUpgradeCommand);
program
  .command("doctor")
  .description("Generate the discovery documents and check this service is ready for agents and Circle's marketplace")
  .option("-n, --network <network>", NETWORK_FLAG)
  .option("--url <url>", "Check a proxy at this URL instead of publicUrl")
  .option("--sample <file>", "JSON of sample responses by route, e.g. { \"GET /weather\": { ... } }")
  .option("--pay", "Make one real paid call per route with the buyer key (CHAINPE_PRIVATE_KEY)")
  .option("--regenerate", "Overwrite the generated documents")
  .option("--json", "Print the report as JSON")
  .action(runDoctorCommand);
program
  .command("status")
  .description("Show current configuration and status")
  .option("-n, --network <network>", "arc | arc-testnet (default: $CHAINPE_NETWORK, then config)")
  .action(runStatus);

program
  .command("fetch <url>")
  .description("Fetch a URL as a consumer, auto-paying any x402 402 in USDC (curl-level)")
  .option("-X, --method <method>", "HTTP method (default GET)")
  .option("-H, --header <header...>", "Request header as \"Key: Value\" (repeatable)")
  .option("-d, --data <body>", "Request body")
  .option("-k, --key <privateKey>", "Consumer wallet key (default: $CHAINPE_PRIVATE_KEY)")
  .option("-n, --network <network>", "arc | arc-testnet (default: $CHAINPE_NETWORK or arc-testnet)")
  .option("--max <usdc>", "Max USDC to auto-pay for one call (default 1)")
  .option("--rail <rail>", "gateway | exact | auto (default auto: Gateway if the deposit covers the price)")
  .option("--raw", "Print only the response body (for piping)")
  .action(runFetchCommand);

program
  .command("deposit <amount>")
  .description("Deposit USDC into Gateway as a consumer, to pay with the gateway rail")
  .option("-k, --key <privateKey>", "Consumer wallet key (default: $CHAINPE_PRIVATE_KEY)")
  .option("-n, --network <network>", "arc | arc-testnet (default: $CHAINPE_NETWORK or arc-testnet)")
  .action(runDepositCommand);

program
  .command("balance")
  .description("Show the seller's Gateway and on-chain USDC balances")
  .option("-n, --network <network>", "arc | arc-testnet (default: $CHAINPE_NETWORK, then config)")
  .action(async (options: { network?: string }) => {
    const { walletAddress, network } = await sellerContext(options.network);
    await runBalanceCommand(walletAddress, network);
  });

program
  .command("withdraw [amount]")
  .description("Withdraw the seller's USDC from Gateway to the payout wallet (the fee is charged on top of the amount)")
  .option("--all", "Withdraw the whole available balance less the fee")
  .option("--chain <name>", "Destination chain as named by Gateway (default: this Arc network)")
  .option("-n, --network <network>", "arc | arc-testnet (default: $CHAINPE_NETWORK, then config)")
  .action(async (amount: string | undefined, options: { all?: boolean; chain?: string; network?: string }) => {
    const { walletAddress, network } = await sellerContext(options.network);
    await runWithdrawCommand(amount, walletAddress, network, { all: options.all, chain: options.chain });
  });

program.command("discover").description("Discover services (not available on Arc yet)").action(runDiscoverCommand);

program.parse();
