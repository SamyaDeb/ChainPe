/**
 * The one path for reading and writing Arc contracts from the CLI.
 *
 * Writes simulate first, so a revert costs no gas and decodes to a custom error,
 * and a transaction only counts once its receipt says it succeeded.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getNetwork, type ChainPeNetwork } from "./chains.js";

export interface ContractCall {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

export interface SentTx {
  label: string;
  hash: Hash;
  receipt: TransactionReceipt;
}

/** What read-only code needs. RPC failures throw: they never look like an empty result. */
export interface ChainReader {
  read<T>(call: ContractCall): Promise<T>;
}

export interface ChainWriter extends ChainReader {
  account: Address;
  send(label: string, call: ContractCall): Promise<SentTx>;
}

/** One sentence the provider can act on, per custom error. */
const REVERT_HELP: Record<string, string> = {
  EnforcedPause: "ChainPeAccounts is paused by its owner. Try again later.",
  InvalidPeriods: "Periods must be between 1 and 12.",
  InvalidStringLength: "A service field is too long or empty. Check name, endpoint, price, network, description and tags.",
  NoPaymentRail: "A service needs at least one payment rail.",
  NotAgentOwner: "This wallet does not own that ERC-8004 agentId.",
  PayToNotSender: "payTo must be the wallet that signs. Check walletAddress and CHAINPE_SELLER_PRIVATE_KEY.",
  ProviderAlreadyExists: "This wallet already has a provider account.",
  ProviderNotFound: "This wallet has no provider account. Run `chainpe register` first.",
  ServiceAlreadyActive: "This service is already active.",
  ServiceLimitReached: "Your plan's service limit is reached. Run `chainpe upgrade` or `chainpe deregister --name <name>`.",
  ServiceNotActive: "This service is not active.",
  ServiceNotFound: "No service with that name is registered by this wallet.",
  SafeERC20FailedOperation: "The USDC transfer failed. Check the balance and allowance.",
  ZeroPrice: "The price must be above zero.",
  ERC721NonexistentToken: "That ERC-8004 agentId does not exist on this network.",
};

/** The custom error a contract call reverted with, if that is what happened. */
export function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
}

/** A short message for the terminal: our sentence for a known revert, else viem's summary. */
export function describeChainError(err: unknown): string {
  const name = revertName(err);
  if (name) return REVERT_HELP[name] ?? `The contract reverted with ${name}.`;
  if (err instanceof BaseError) return err.shortMessage;
  return err instanceof Error ? err.message : String(err);
}

export function createChainWriter(publicClient: PublicClient, walletClient: WalletClient, account: Address): ChainWriter {
  return {
    account,
    read: (call) => publicClient.readContract(call as never) as never,
    async send(label, call) {
      let request;
      try {
        ({ request } = await publicClient.simulateContract({ ...call, account: walletClient.account ?? account } as never));
      } catch (err) {
        throw new Error(`${label}: ${describeChainError(err)}`, { cause: err });
      }
      const hash = await walletClient.writeContract(request as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`${label}: transaction reverted on-chain (${hash}).`);
      }
      return { label, hash, receipt };
    },
  };
}

export function chainReader(network: ChainPeNetwork): ChainReader {
  const info = getNetwork(network);
  const publicClient = createPublicClient({ chain: info.chain, transport: http(info.rpcUrl) });
  return { read: (call) => publicClient.readContract(call as never) as never };
}

/** Signs with a key already checked by resolveSellerKey. The key stays in memory. */
export function chainWriter(network: ChainPeNetwork, privateKey: Hex): ChainWriter {
  const info = getNetwork(network);
  const account = privateKeyToAccount(privateKey);
  const transport = http(info.rpcUrl);
  return createChainWriter(
    createPublicClient({ chain: info.chain, transport }),
    createWalletClient({ account, chain: info.chain, transport }),
    account.address
  );
}
