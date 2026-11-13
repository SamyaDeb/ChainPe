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
