/**
 * PolicyVault client — programmable, gasless agent spending.
 *
 * Three roles, one client (whichever key you construct it with):
 *  - **owner**   funds the vault + sets the policy/allowlist (`deposit`,
 *    `setPolicy`, `setAllowlist`, `revokeSession`) — owner pays gas.
 *  - **agent**   holds the session key and only *signs* spends (`signSpend`) —
 *    no gas, no tx.
 *  - **relayer** submits a signed spend (`relaySpend`) and pays the gas.
 *
 * The on-chain `PolicyVault` enforces every limit; an over-cap or non-allowlisted
 * spend reverts (the rejection reason is surfaced as the thrown error).
 */
import {
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  getAddress,
  type Hex,
  type WalletClient
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  publicClientFor,
  rpcUrlFor,
  chainFor,
  normalizeKey,
  USDC_DECIMALS
} from './networks.js'
import type { ChainPeNetwork } from './types.js'

const VAULT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'setPolicy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sessionKey', type: 'address' },
      { name: 'maxPerCall', type: 'uint256' },
      { name: 'dailyCap', type: 'uint256' },
      { name: 'totalBudget', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
      { name: 'allowlistOnly', type: 'bool' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'setAllowlist',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'allowed', type: 'bool' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'revokeSession',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: []
  },
  {
    type: 'function',
    name: 'spend',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'sessionSig', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'dailyRemaining',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'budgetRemaining',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const

const SPEND_TYPES = {
  Spend: [
    { name: 'owner', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ]
} as const

export interface PolicyVaultOptions {
  privateKey: string
  network?: ChainPeNetwork
  vaultAddress: string
}

export interface PolicyParams {
  sessionKey: string
  /** Human USDC strings. */
  maxPerCall: string
  dailyCap: string
  totalBudget: string
  /** Unix seconds the session is valid until. */
  expiry: number
  allowlistOnly?: boolean
}

/** A session-signed spend authorization, ready for a relayer to submit. */
export interface SpendAuthorization {
  owner: string
  to: string
  /** Human USDC string. */
  amount: string
  amountAtomic: string
  nonce: string
  deadline: number
  signature: Hex
}

export class PolicyVaultClient {
  readonly network: ChainPeNetwork
  readonly vault: `0x${string}`
  private readonly account

  constructor(options: PolicyVaultOptions) {
    if (!options.privateKey) throw new Error('PolicyVaultClient: privateKey required')
    if (!options.vaultAddress) throw new Error('PolicyVaultClient: vaultAddress required')
    this.network = options.network ?? 'fuji'
    this.vault = getAddress(options.vaultAddress)
    this.account = privateKeyToAccount(normalizeKey(options.privateKey))
  }

  getAddress(): string {
    return this.account.address
  }

  private wallet(): WalletClient {
    return createWalletClient({
      account: this.account,
      chain: chainFor(this.network),
      transport: http(rpcUrlFor(this.network))
    })
  }

  private usdc(human: string): bigint {
    return parseUnits(human, USDC_DECIMALS)
  }

  // ─── reads ────────────────────────────────────────────────────────────────

  async balanceOf(owner: string): Promise<string> {
    const raw = (await publicClientFor(this.network).readContract({
      address: this.vault,
      abi: VAULT_ABI,
      functionName: 'balanceOf',
      args: [getAddress(owner)]
    })) as bigint
    return formatUnits(raw, USDC_DECIMALS)
  }

  async dailyRemaining(owner: string): Promise<string> {
    const raw = (await publicClientFor(this.network).readContract({
      address: this.vault,
      abi: VAULT_ABI,
      functionName: 'dailyRemaining',
      args: [getAddress(owner)]
    })) as bigint
    return formatUnits(raw, USDC_DECIMALS)
  }

  async budgetRemaining(owner: string): Promise<string> {
    const raw = (await publicClientFor(this.network).readContract({
      address: this.vault,
      abi: VAULT_ABI,
      functionName: 'budgetRemaining',
      args: [getAddress(owner)]
    })) as bigint
    return formatUnits(raw, USDC_DECIMALS)
  }

  async nonce(owner: string): Promise<bigint> {
    return (await publicClientFor(this.network).readContract({
      address: this.vault,
      abi: VAULT_ABI,
      functionName: 'nonces',
      args: [getAddress(owner)]
    })) as bigint
  }

  // ─── owner ops (this key is the owner) ──────────────────────────────────────

  async deposit(human: string): Promise<Hex> {
    return this.wallet().writeContract({
      account: this.account,
      chain: chainFor(this.network),
      address: this.vault,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [this.usdc(human)]
    })
  }

  async withdraw(human: string): Promise<Hex> {
    return this.wallet().writeContract({
      account: this.account,
      chain: chainFor(this.network),
      address: this.vault,
      abi: VAULT_ABI,
      functionName: 'withdraw',
      args: [this.usdc(human)]
    })
  }

  async setPolicy(p: PolicyParams): Promise<Hex> {
    return this.wallet().writeContract({
      account: this.account,
      chain: chainFor(this.network),
      address: this.vault,
      abi: VAULT_ABI,
      functionName: 'setPolicy',
      args: [
        getAddress(p.sessionKey),
        this.usdc(p.maxPerCall),
        this.usdc(p.dailyCap),
        this.usdc(p.totalBudget),
        BigInt(p.expiry),
        p.allowlistOnly ?? false
      ]
    })
  }

  async setAllowlist(to: string, allowed: boolean): Promise<Hex> {
    return this.wallet().writeContract({
      account: this.account,
      chain: chainFor(this.network),
      address: this.vault,
      abi: VAULT_ABI,
      functionName: 'setAllowlist',
      args: [getAddress(to), allowed]
    })
  }

  async revokeSession(): Promise<Hex> {
    return this.wallet().writeContract({
      account: this.account,
      chain: chainFor(this.network),
      address: this.vault,
      abi: VAULT_ABI,
      functionName: 'revokeSession',
      args: []
    })
  }

  // ─── agent: sign a spend (gasless — no tx) ──────────────────────────────────

  /**
   * Signs a spend authorization with this key (the session key). Reads the
   * owner's current nonce so the relayer can submit it. `ttlSeconds` bounds how
   * long the authorization stays valid (default 5 min).
   */
  async signSpend(params: {
    owner: string
    to: string
    amount: string
    ttlSeconds?: number
  }): Promise<SpendAuthorization> {
    const owner = getAddress(params.owner)
    const to = getAddress(params.to)
    const amountAtomic = this.usdc(params.amount)
    const nonce = await this.nonce(owner)
    const deadline = Math.floor(Date.now() / 1000) + (params.ttlSeconds ?? 300)

    const signature = await this.account.signTypedData({
      domain: {
        name: 'ChainPePolicyVault',
        version: '1',
        chainId: chainFor(this.network).id,
        verifyingContract: this.vault
      },
      types: SPEND_TYPES,
      primaryType: 'Spend',
      message: {
        owner,
        to,
        amount: amountAtomic,
        nonce,
        deadline: BigInt(deadline)
      }
    })

    return {
      owner,
      to,
      amount: params.amount,
      amountAtomic: amountAtomic.toString(),
      nonce: nonce.toString(),
      deadline,
      signature
    }
  }

  // ─── relayer: submit a signed spend (pays gas) ──────────────────────────────

  /**
   * Submits a session-signed spend. Throws with the on-chain revert reason if a
   * policy limit is violated (e.g. "over per-call cap").
   */
  async relaySpend(auth: SpendAuthorization): Promise<Hex> {
    return this.wallet().writeContract({
      account: this.account,
      chain: chainFor(this.network),
      address: this.vault,
      abi: VAULT_ABI,
      functionName: 'spend',
      args: [
        getAddress(auth.owner),
        getAddress(auth.to),
        BigInt(auth.amountAtomic),
        BigInt(auth.deadline),
        auth.signature
      ]
    })
  }
}
