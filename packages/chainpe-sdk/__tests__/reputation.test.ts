import { describe, it, expect } from 'vitest'
import { summaryToScore, getReputation } from '../src/reputation.js'

describe('summaryToScore', () => {
  it('applies the on-chain decimals', () => {
    expect(summaryToScore(95n, 0)).toBe(95)
    expect(summaryToScore(9500n, 2)).toBe(95)
    expect(summaryToScore(0n, 0)).toBe(0)
  })
})

describe('getReputation guards', () => {
  it('returns null for unlinked agents (id 0 / empty)', async () => {
    const reg = '0x89476DfEf9c72a668fa5E86f154B73EDB053aFe4' as const
    expect(await getReputation('fuji', reg, '0')).toBeNull()
    expect(await getReputation('fuji', reg, '')).toBeNull()
  })

  it('returns null when no reputation registry is configured', async () => {
    expect(await getReputation('fuji', undefined, '5')).toBeNull()
  })
})

describe('giveFeedback paymentTx', () => {
  it('rejects a malformed payment tx before touching the network', async () => {
    const { giveFeedback } = await import('../src/reputation.js')
    const key = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    const reg = '0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543'
    await expect(giveFeedback('avalanche', reg, key, { agentId: '1', value: 90, paymentTx: '0x1234' })).rejects.toThrow(/32-byte/)
    await expect(giveFeedback('avalanche', reg, key, { agentId: '1', value: 90, paymentTx: 'nothex' })).rejects.toThrow(/32-byte/)
  })
})
