/**
 * What `chainpe register` and `chainpe upgrade` do on-chain.
 *
 * Registration reads first and sends only what is missing, so a run that failed
 * halfway resumes, and a run with nothing to do sends no transaction.
 */
import { erc20Abi, getAddress, type Address, type Hex } from "viem";
import { PERIOD_SECONDS, serviceKey, type AccountsWriter, type OnChainService, type ProviderAccount, type ServiceInput } from "./accounts.js";
import { formatUsdc } from "./evm.js";
import type { ChainWriter, SentTx } from "./onchain.js";

export type RegistrationStep = "registerProvider" | "setAgentId" | "registerService" | "updateService";

/** Same listing, including the agentId snapshot, which setAgentId does not refresh. */
export function listingMatches(service: OnChainService, input: ServiceInput, agentId: bigint): boolean {
  return (
    service.description === input.description &&
    service.tags === input.tags &&
    service.endpoint === input.endpoint &&
    service.pricePerRequest === input.pricePerRequest &&
    service.network === input.network &&
    getAddress(service.payTo) === getAddress(input.payTo) &&
    service.acceptsExact === input.acceptsExact &&
    service.acceptsGateway === input.acceptsGateway &&
    service.agentId === agentId
  );
}

export interface RegistrationState {
  provider: ProviderAccount;
  service: OnChainService | null;
  maxServices: bigint;
}

/** Decides the transactions. Throws before anything is sent if the plan's limit would stop them. */
export function planRegistration(state: RegistrationState, input: ServiceInput, agentId: bigint): RegistrationStep[] {
  const { provider, service, maxServices } = state;
  const steps: RegistrationStep[] = [];
  if (!provider.exists) steps.push("registerProvider");
  else if (provider.agentId !== agentId) steps.push("setAgentId");

  if (service?.active) {
    if (!listingMatches(service, input, agentId)) steps.push("updateService");
  } else {
    if (BigInt(provider.activeServices) >= maxServices) {
      throw new Error(
        `Your plan allows ${maxServices} active service(s) and you have ${provider.activeServices}. ` +
          "Run `chainpe upgrade`, or `chainpe deregister --name <name>` to free a slot."
      );
    }
    steps.push("registerService");
  }
  return steps;
}

export interface RegistrationResult {
  key: Hex;
  steps: RegistrationStep[];
  txs: SentTx[];
  reactivated: boolean;
}

export async function syncRegistration(
  accounts: AccountsWriter,
  seller: Address,
  input: ServiceInput,
  agentId: bigint,
  onTx: (tx: SentTx) => void = () => {}
): Promise<RegistrationResult> {
  const key = serviceKey(seller, input.name);
  const [provider, service, maxServices] = await Promise.all([accounts.provider(seller), accounts.service(key), accounts.maxServices(seller)]);
  const steps = planRegistration({ provider, service, maxServices }, input, agentId);

  const txs: SentTx[] = [];
  const run = async (tx: Promise<SentTx>) => {
    const sent = await tx;
    txs.push(sent);
    onTx(sent);
  };
  for (const step of steps) {
    if (step === "registerProvider") await run(accounts.registerProvider(agentId));
    if (step === "setAgentId") await run(accounts.setAgentId(agentId));
    if (step === "registerService") await run(accounts.registerService(input));
    if (step === "updateService") await run(accounts.updateService(input));
  }
  return { key, steps, txs, reactivated: service !== null && !service.active };
}

/** Enough USDC for approve and subscribe gas. Gas on Arc is paid in USDC. */
export const UPGRADE_GAS_MARGIN = 50_000n;

export interface UpgradeQuote {
  amount: bigint;
  balance: bigint;
  allowance: bigint;
}

export async function quoteUpgrade(chain: ChainWriter, accounts: AccountsWriter, usdc: Address, periods: number): Promise<UpgradeQuote> {
  if (!Number.isInteger(periods) || periods < 1 || periods > 12) throw new Error("--periods must be a whole number from 1 to 12.");
  const [price, balance, allowance] = await Promise.all([
    accounts.proPrice(),
    chain.read<bigint>({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [chain.account] }),
    chain.read<bigint>({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [chain.account, accounts.address] }),
  ]);
  return { amount: price * BigInt(periods), balance, allowance };
}

export interface UpgradeResult {
  txs: SentTx[];
  before: bigint;
  after: bigint;
  allowanceAfter: bigint;
}

/**
 * Approves exactly the quoted amount, then subscribes, then checks the plan really
 * moved. If the owner raises the price in between, subscribe reverts on the
 * allowance rather than charging more than the provider agreed to.
 */
export async function runUpgrade(
  chain: ChainWriter,
  accounts: AccountsWriter,
  usdc: Address,
  periods: number,
  quote: UpgradeQuote,
  now: () => bigint = () => BigInt(Math.floor(Date.now() / 1000)),
  onTx: (tx: SentTx) => void = () => {}
): Promise<UpgradeResult> {
  const provider = await accounts.provider(chain.account);
  if (!provider.exists) throw new Error("This wallet has no provider account. Run `chainpe register` first.");
  const needed = quote.amount + UPGRADE_GAS_MARGIN;
  if (quote.balance < needed) {
    throw new Error(`Needs ${formatUsdc(needed)} USDC (price plus gas). Balance: ${formatUsdc(quote.balance)} USDC.`);
  }

  const txs: SentTx[] = [];
  if (quote.allowance !== quote.amount) {
    const approved = await chain.send("USDC.approve", { address: usdc, abi: erc20Abi, functionName: "approve", args: [accounts.address, quote.amount] });
    txs.push(approved);
    onTx(approved);
  }
  const subscribed = await accounts.subscribe(periods);
  txs.push(subscribed);
  onTx(subscribed);

  const after = (await accounts.provider(chain.account)).paidUntil;
  const allowanceAfter = await chain.read<bigint>({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [chain.account, accounts.address] });
  const added = BigInt(periods) * PERIOD_SECONDS;
  const start = now();
  // A live plan extends exactly. A lapsed one restarts from the block time, which we only know roughly.
  const moved = provider.paidUntil > start ? after === provider.paidUntil + added : after >= start + added - 600n;
  if (!moved) {
    throw new Error(`subscribe succeeded (${subscribed.hash}) but paidUntil is ${after}, not what ${periods} period(s) should give.`);
  }
  return { txs, before: provider.paidUntil, after, allowanceAfter };
}
