import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadConfig } from '../src/config.js'

vi.mock('../src/wallet-store.js', () => ({
  loadWalletConfig: vi.fn(() => null)
}))

const TEST_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.CHAINPE_PRIVATE_KEY
    delete process.env.NETWORK
    delete process.env.MAX_PER_CALL
    delete process.env.MAX_PER_DAY
    delete process.env.CHAINPE_ACCOUNTS_ADDRESS
    delete process.env.ALLOW_MAINNET
    delete process.env.RAILS
  })

  it('returns READ_ONLY when no key is set', () => {
    const config = loadConfig()
    expect(config.mode).toBe('READ_ONLY')
    expect(config.canPay).toBe(false)
  })

  it('returns ARC when a private key is set', () => {
    process.env.CHAINPE_PRIVATE_KEY = TEST_KEY
    const config = loadConfig()
    expect(config.mode).toBe('ARC')
    expect(config.canPay).toBe(true)
  })

  it('defaults to Arc testnet and both rails', () => {
    const config = loadConfig()
    expect(config.network).toBe('arc-testnet')
    expect(config.rails).toEqual(['gateway', 'exact'])
  })

  it('falls back to Arc testnet for unknown NETWORK values', () => {
    for (const value of ['fuji', 'avalanche', 'base']) {
      process.env.NETWORK = value
      expect(loadConfig().network).toBe('arc-testnet')
    }
  })

  it('stays on testnet for NETWORK=arc unless mainnet is allowed', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.NETWORK = 'arc'
    expect(loadConfig().network).toBe('arc-testnet')
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/real USDC/))
    process.env.ALLOW_MAINNET = 'true'
    expect(loadConfig().network).toBe('arc')
    warn.mockRestore()
  })

  it('reads rails in order and ignores anything else', () => {
    process.env.RAILS = 'exact, card, gateway'
    expect(loadConfig().rails).toEqual(['exact', 'gateway'])
    process.env.RAILS = 'card'
    expect(loadConfig().rails).toEqual(['gateway', 'exact'])
  })

  it('treats empty values from the Claude Desktop form as not set', () => {
    process.env.CHAINPE_PRIVATE_KEY = ''
    process.env.MAX_PER_CALL = ''
    const config = loadConfig()
    expect(config.canPay).toBe(false)
    expect(config.budget.maxPerCall).toBe('0.10')
  })

  it('reads the ChainPeAccounts address from env', () => {
    process.env.CHAINPE_ACCOUNTS_ADDRESS =
      '0x1111111111111111111111111111111111111111'
    const config = loadConfig()
    expect(config.accountsAddress).toBe(
      '0x1111111111111111111111111111111111111111'
    )
  })

  it('uses default budget limits', () => {
    const config = loadConfig()
    expect(config.budget.maxPerCall).toBe('0.10')
    expect(config.budget.maxPerDay).toBe('20.00')
  })

  it('respects budget env vars', () => {
    process.env.MAX_PER_CALL = '5.00'
    process.env.MAX_PER_DAY = '100.00'
    const config = loadConfig()
    expect(config.budget.maxPerCall).toBe('5.00')
    expect(config.budget.maxPerDay).toBe('100.00')
  })

  it('reload refreshes config', () => {
    const config = loadConfig()
    expect(config.mode).toBe('READ_ONLY')
    process.env.CHAINPE_PRIVATE_KEY = TEST_KEY
    config.reload()
    expect(config.mode).toBe('ARC')
  })
})
