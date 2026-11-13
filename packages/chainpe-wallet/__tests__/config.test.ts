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
    delete process.env.CHAINPE_REGISTRY_ADDRESS
  })

  it('returns READ_ONLY when no key is set', () => {
    const config = loadConfig()
    expect(config.mode).toBe('READ_ONLY')
    expect(config.canPay).toBe(false)
  })

  it('returns AVALANCHE when a private key is set', () => {
    process.env.CHAINPE_PRIVATE_KEY = TEST_KEY
    const config = loadConfig()
    expect(config.mode).toBe('AVALANCHE')
    expect(config.canPay).toBe(true)
  })

  it('uses default network fuji', () => {
    const config = loadConfig()
    expect(config.network).toBe('fuji')
  })

  it('respects NETWORK env var', () => {
    process.env.NETWORK = 'avalanche'
    const config = loadConfig()
    expect(config.network).toBe('avalanche')
  })

  it('falls back to fuji for unknown NETWORK values', () => {
    process.env.NETWORK = 'algorand-testnet'
    const config = loadConfig()
    expect(config.network).toBe('fuji')
  })

  it('reads registry address from env', () => {
    process.env.CHAINPE_REGISTRY_ADDRESS =
      '0x1111111111111111111111111111111111111111'
    const config = loadConfig()
    expect(config.registryAddress).toBe(
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
    expect(config.mode).toBe('AVALANCHE')
  })
})
