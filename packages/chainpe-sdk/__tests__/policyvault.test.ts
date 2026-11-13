import { describe, it, expect, vi } from 'vitest'
import { recoverTypedDataAddress } from 'viem'
import { PolicyVaultClient } from '../src/policyvault.js'

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const SESSION_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const VAULT = '0x0000000000000000000000000000000000000001'
const OWNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const TO = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

describe('PolicyVaultClient', () => {
  it('validates constructor inputs', () => {
    // @ts-expect-error missing fields
    expect(() => new PolicyVaultClient({})).toThrow(/privateKey/)
    expect(
      () => new PolicyVaultClient({ privateKey: KEY, vaultAddress: '' })
    ).toThrow(/vaultAddress/)
  })

  it('derives the session-key address', () => {
    const cp = new PolicyVaultClient({ privateKey: KEY, vaultAddress: VAULT })
    expect(cp.getAddress().toLowerCase()).toBe(SESSION_ADDR.toLowerCase())
  })

  it('signs a spend that recovers to the session key with the contract typing', async () => {
    const cp = new PolicyVaultClient({
      privateKey: KEY,
      network: 'fuji',
      vaultAddress: VAULT
    })
    vi.spyOn(cp, 'nonce').mockResolvedValue(3n)

    const auth = await cp.signSpend({ owner: OWNER, to: TO, amount: '1.5' })

    expect(auth.amountAtomic).toBe('1500000') // 1.5 USDC, 6 decimals
    expect(auth.nonce).toBe('3')
    expect(auth.deadline).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(auth.signature).toMatch(/^0x[0-9a-f]+$/i)

    // The signature must recover to the session key under the exact EIP-712
    // domain + Spend type the on-chain PolicyVault verifies.
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: 'ChainPePolicyVault',
        version: '1',
        chainId: 43113,
        verifyingContract: VAULT
      },
      types: {
        Spend: [
          { name: 'owner', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' }
        ]
      },
      primaryType: 'Spend',
      message: {
        owner: OWNER,
        to: TO,
        amount: 1_500_000n,
        nonce: 3n,
        deadline: BigInt(auth.deadline)
      },
      signature: auth.signature
    })
    expect(recovered.toLowerCase()).toBe(SESSION_ADDR.toLowerCase())
  })
})
