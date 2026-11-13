import { describe, it, expect, vi } from 'vitest'
import type { ChainPe } from '@chainpe/sdk'
import {
  getClient,
  runFetch,
  runDiscover,
  fetchInputSchema,
  discoverInputSchema
} from '../src/core.js'

function mockClient(over: Partial<ChainPe> = {}): ChainPe {
  return {
    pay: vi.fn(),
    discover: vi.fn(),
    ...over
  } as unknown as ChainPe
}

describe('getClient', () => {
  it('returns a pre-built client as-is', () => {
    const client = mockClient()
    expect(getClient({ client })).toBe(client)
  })
})

describe('input schemas', () => {
  it('accepts a minimal fetch input and rejects a bad URL', () => {
    expect(fetchInputSchema.safeParse({ url: 'https://a.com/x' }).success).toBe(
      true
    )
    expect(fetchInputSchema.safeParse({ url: 'not-a-url' }).success).toBe(false)
  })

  it('accepts empty discover input', () => {
    expect(discoverInputSchema.safeParse({}).success).toBe(true)
  })
})

describe('runFetch', () => {
  it('forwards method/headers/body and normalizes the result', async () => {
    const pay = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: {},
      data: { answer: 42 },
      payment: {
        amount: '0.01',
        recipient: '0xabc',
        network: 'fuji' as const,
        txHash: '0xdead',
        settlement: { foo: 'bar' }
      },
      reputation: { agentId: '7', score: 100, txHash: '0xfeed' }
    }))
    const client = mockClient({ pay: pay as unknown as ChainPe['pay'] })

    const out = await runFetch(client, {
      url: 'https://api.example.com/paid',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"q":"hi"}'
    })

    expect(pay).toHaveBeenCalledWith('https://api.example.com/paid', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"q":"hi"}'
    })
    expect(out.data).toEqual({ answer: 42 })
    // settlement is dropped from the tool-facing payment shape.
    expect(out.payment).toEqual({
      amount: '0.01',
      recipient: '0xabc',
      network: 'fuji',
      txHash: '0xdead'
    })
    expect(out.reputation).toEqual({ agentId: '7', score: 100, txHash: '0xfeed' })
  })

  it('omits payment when no payment was made', async () => {
    const pay = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: {},
      data: 'plain'
    }))
    const client = mockClient({ pay: pay as unknown as ChainPe['pay'] })
    const out = await runFetch(client, { url: 'https://a.com/free' })
    expect(out.payment).toBeUndefined()
    expect(out.data).toBe('plain')
  })
})

describe('runDiscover', () => {
  it('flattens reputation into score/count fields', async () => {
    const discover = vi.fn(async () => [
      {
        id: 'd:translate',
        name: 'translate',
        description: 'x',
        tags: ['ai'],
        endpoint: 'https://t/translate',
        pricePerRequest: '0.01',
        paymentToken: 'USDC' as const,
        walletAddress: '0x1',
        network: 'fuji' as const,
        developer: '0x9',
        agentId: '5',
        reputation: { score: 90, count: 3 }
      },
      {
        id: 'd:weather',
        name: 'weather',
        description: 'y',
        tags: ['data'],
        endpoint: 'https://t/weather',
        pricePerRequest: '0.5',
        paymentToken: 'USDC' as const,
        walletAddress: '0x2',
        network: 'fuji' as const,
        developer: '0x9',
        reputation: null
      }
    ])
    const client = mockClient({
      discover: discover as unknown as ChainPe['discover']
    })

    const out = await runDiscover(client, { query: 'a' })
    expect(discover).toHaveBeenCalledWith({
      query: 'a',
      tags: undefined,
      maxPrice: undefined
    })
    expect(out[0]).toMatchObject({
      name: 'translate',
      reputationScore: 90,
      reputationCount: 3
    })
    expect(out[1]).toMatchObject({
      name: 'weather',
      reputationScore: null,
      reputationCount: 0
    })
  })
})
