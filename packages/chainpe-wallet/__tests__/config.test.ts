import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadConfig } from '../src/config.js'

vi.mock('../src/wallet-store.js', () => ({
  loadWalletConfig: vi.fn(() => null)
}))

// A valid 25-word Algorand mnemonic (test vector — zero key).
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon abandon invest'

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.ALGORAND_MNEMONIC
    delete process.env.NETWORK
    delete process.env.MAX_PER_CALL
    delete process.env.MAX_PER_DAY
    delete process.env.CHAINPE_REGISTRY_APP_ID
  })

  it('returns READ_ONLY when no mnemonic is set', () => {
    const config = loadConfig()
    expect(config.mode).toBe('READ_ONLY')
    expect(config.canPay).toBe(false)
    expect(config.canPayAlgorand).toBe(false)
  })

  it('returns ALGORAND_ONLY when a mnemonic is set', () => {
    process.env.ALGORAND_MNEMONIC = TEST_MNEMONIC
    const config = loadConfig()
    expect(config.mode).toBe('ALGORAND_ONLY')
    expect(config.canPay).toBe(true)
    expect(config.canPayAlgorand).toBe(true)
  })

  it('uses default network algorand-testnet', () => {
    const config = loadConfig()
    expect(config.network).toBe('algorand-testnet')
  })

  it('respects NETWORK env var', () => {
    process.env.NETWORK = 'algorand'
    const config = loadConfig()
    expect(config.network).toBe('algorand')
  })

  it('reads registry app id from env', () => {
    process.env.CHAINPE_REGISTRY_APP_ID = '123456'
    const config = loadConfig()
    expect(config.registryAppId).toBe('123456')
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

    process.env.ALGORAND_MNEMONIC = TEST_MNEMONIC
    config.reload()
    expect(config.mode).toBe('ALGORAND_ONLY')
  })
})
