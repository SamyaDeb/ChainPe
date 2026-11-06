/**
 * Client for the ChainPeAccounts contract on Arc: provider accounts, service
 * listings and Pro plans.
 */
import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import { chainPeAccountsAbi } from "./abi/ChainPeAccounts.js";
import { getNetwork, type ChainPeNetwork } from "./chains.js";
import { revertName, type ChainReader, type ChainWriter, type ContractCall, type SentTx } from "./onchain.js";

export interface ProviderAccount {
  exists: boolean;
  agentId: bigint;
  createdAt: bigint;
  paidUntil: bigint;
  activeServices: number;
}

/** Struct field names and types, as the contract returns them. */
export interface OnChainService {
  key: Hex;
  provider: Address;
  payTo: Address;
  agentId: bigint;
  name: string;
  description: string;
  tags: string;
  endpoint: string;
  pricePerRequest: string;
  network: string;
  acceptsExact: boolean;
  acceptsGateway: boolean;
  active: boolean;
  createdAt: bigint;
  updatedAt: bigint;
}

export interface ServiceInput {
  name: string;
  description: string;
  tags: string;
  endpoint: string;
  pricePerRequest: string;
  network: string;
  payTo: Address;
  acceptsExact: boolean;
  acceptsGateway: boolean;
}

export const PERIOD_SECONDS = 30n * 24n * 60n * 60n;

/** keccak256(abi.encode(provider, name)), the same as the contract's computeKey. */
export function serviceKey(provider: string, name: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "string" }], [getAddress(provider), name]));
}

export function accountsAddress(network: ChainPeNetwork): Address {
  const { accountsAddress: address } = getNetwork(network);
  if (!address) throw new Error(`ChainPeAccounts is not deployed on ${network} yet.`);
  return address;
}

export class AccountsReader {
  constructor(
    protected readonly chain: ChainReader,
    readonly address: Address
  ) {}

  protected call(functionName: string, args: readonly unknown[] = []): ContractCall {
    return { address: this.address, abi: chainPeAccountsAbi, functionName, args };
  }

  protected read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return this.chain.read<T>(this.call(functionName, args));
  }

  /** CHAINPE_ACCOUNTS_ADDRESS can point anywhere, so check it is ours before trusting or paying it. */
  async assertDeployment(network: ChainPeNetwork): Promise<void> {
    const info = getNetwork(network);
    const wrong = new Error(`Contract ${this.address} is not a ChainPeAccounts deployment for ${network}. Check CHAINPE_ACCOUNTS_ADDRESS.`);
    let usdc: Address;
    let identityRegistry: Address;
    try {
      [usdc, identityRegistry] = await Promise.all([this.read<Address>("usdc"), this.read<Address>("identityRegistry")]);
    } catch (err) {
      // The contract answered, and not as ChainPeAccounts would. Anything else is an outage, not a wrong address.
      if (err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError || e instanceof ContractFunctionZeroDataError)) throw wrong;
      throw err;
    }
    if (getAddress(usdc) !== getAddress(info.usdc) || getAddress(identityRegistry) !== getAddress(info.identityRegistry)) throw wrong;
  }

  async provider(address: string): Promise<ProviderAccount> {
    const [exists, agentId, createdAt, paidUntil, activeServices] = await this.read<readonly [boolean, bigint, bigint, bigint, number]>(
      "providers",
      [getAddress(address)]
    );
    return { exists, agentId, createdAt, paidUntil, activeServices };
  }

  /** The service, or null only when the contract says it does not exist. */
  async service(key: Hex): Promise<OnChainService | null> {
    try {
      return await this.read<OnChainService>("getService", [key]);
    } catch (err) {
      if (revertName(err) === "ServiceNotFound") return null;
      throw err;
    }
  }

  planOf(address: string): Promise<number> {
    return this.read<number>("planOf", [getAddress(address)]);
  }

  maxServices(address: string): Promise<bigint> {
    return this.read<bigint>("maxServices", [getAddress(address)]);
  }

  proPrice(): Promise<bigint> {
    return this.read<bigint>("proPricePerPeriod");
  }

  serviceCount(): Promise<bigint> {
    return this.read<bigint>("serviceCount");
  }

  page(offset: bigint, limit: bigint): Promise<readonly OnChainService[]> {
    return this.read<readonly OnChainService[]>("getServices", [offset, limit]);
  }

  servicesOf(address: string): Promise<readonly Hex[]> {
    return this.read<readonly Hex[]>("servicesOf", [getAddress(address)]);
  }
}

export class AccountsWriter extends AccountsReader {
  constructor(
    private readonly writer: ChainWriter,
    address: Address
  ) {
    super(writer, address);
  }

  private send(label: string, functionName: string, args: readonly unknown[]): Promise<SentTx> {
    return this.writer.send(label, this.call(functionName, args));
  }

  registerProvider(agentId: bigint): Promise<SentTx> {
    return this.send("registerProvider", "registerProvider", [agentId]);
  }

  setAgentId(agentId: bigint): Promise<SentTx> {
    return this.send("setAgentId", "setAgentId", [agentId]);
  }

  registerService(input: ServiceInput): Promise<SentTx> {
    return this.send("registerService", "registerService", [input]);
  }

  updateService(input: ServiceInput): Promise<SentTx> {
    return this.send("updateService", "updateService", [input]);
  }

  deactivateService(name: string): Promise<SentTx> {
    return this.send("deactivateService", "deactivateService", [name]);
  }

  subscribe(periods: number): Promise<SentTx> {
    return this.send("subscribe", "subscribe", [periods]);
  }
}
