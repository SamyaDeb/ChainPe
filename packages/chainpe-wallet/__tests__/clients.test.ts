import { describe, it, expect } from 'vitest'
import { getX402Network, getUsdcAddress, rpcUrlFor } from '../src/clients.js'

describe('network helpers', () => {
  describe('getX402Network', () => {
    it('maps fuji to avalanche-fuji', () => {
      expect(getX402Network('fuji')).toBe('avalanche-fuji')
    })
    it('maps avalanche to avalanche', () => {
      expect(getX402Network('avalanche')).toBe('avalanche')
    })
  })

  describe('getUsdcAddress', () => {
    it('returns the Fuji USDC address', () => {
      expect(getUsdcAddress('fuji')).toBe(
        '0x5425890298aed601595a70AB815c96711a31Bc65'
      )
    })
    it('returns the mainnet USDC address', () => {
      expect(getUsdcAddress('avalanche')).toBe(
        '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
      )
    })
  })

  describe('rpcUrlFor', () => {
    it('returns the Fuji RPC', () => {
      expect(rpcUrlFor('fuji')).toContain('avax-test.network')
    })
  })
})
