import { describe, it, expect } from 'vitest'
import { isAlgorandNetwork, getCaip2Network } from '../src/clients.js'

describe('network helpers', () => {
  describe('isAlgorandNetwork', () => {
    it('returns true for algorand', () => {
      expect(isAlgorandNetwork('algorand')).toBe(true)
    })

    it('returns true for algorand-testnet', () => {
      expect(isAlgorandNetwork('algorand-testnet')).toBe(true)
    })
  })

  describe('getCaip2Network', () => {
    it('maps algorand to its mainnet genesis CAIP-2', () => {
      expect(getCaip2Network('algorand')).toBe(
        'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8='
      )
    })

    it('maps algorand-testnet to its testnet genesis CAIP-2', () => {
      expect(getCaip2Network('algorand-testnet')).toBe(
        'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
      )
    })
  })
})
