import { describe, it, expect, vi, afterEach } from 'vitest'
import { ChainPe, railPolicy } from '../src/chainpe.js'
import { ChainPePaymentError } from '../src/types.js'

// Well-known Hardhat test account #0 (public, not a real secret).
const TEST_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const TEST_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const PAY_TO = '0x261f058496D81703c858DDFEd201834F0b5f2e73'
const USDC = '0x3600000000000000000000000000000000000000'
const NETWORK = 'eip155:5042002'
const TX = `0x${'ab'.repeat(32)}`
const URL_PAID = 'https://api.example.com/paid'

const exact = (amount = '10000', network = NETWORK) => ({
  scheme: 'exact',
  network,
  amount,
  asset: USDC,
  payTo: PAY_TO,
  maxTimeoutSeconds: 300,
  extra: { name: 'USDC', version: '2', paymentFlow: 'upfront' }
})

const gateway = (amount = '10000') => ({
  scheme: 'exact',
  network: NETWORK,
  amount,
  asset: USDC,
  payTo: PAY_TO,
  maxTimeoutSeconds: 345600,
  extra: {
    name: 'GatewayWalletBatched',
    version: '1',
    verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
    paymentFlow: 'upfront'
  }
})

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64')

function paymentRequired(accepts: unknown[], headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: 'Payment required' }), {
    status: 402,
    headers: {
      'content-type': 'application/json',
      'PAYMENT-REQUIRED': encode({
        x402Version: 2,
        error: 'Payment required',
        resource: { url: URL_PAID, description: 'test', mimeType: '' },
        accepts
      }),
      ...headers
    }
  })
}

function paid(transaction = TX, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ hello: 'world' }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'PAYMENT-RESPONSE': encode({ success: true, transaction, network: NETWORK, payer: TEST_ADDR }),
      ...headers
    }
  })
}

/** Answers the first request, then the paid retry. Records whether the retry carried a payment. */
function stubFlow(first: Response, second: Response = paid()) {
  const calls: Request[] = []
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Request(input, init))
    return calls.length === 1 ? first : second
  })
  vi.stubGlobal('fetch', stub)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ChainPe construction', () => {
  it('requires a private key', () => {
    // @ts-expect-error intentional misuse
    expect(() => new ChainPe({})).toThrow(/privateKey/)
  })

  it('derives the wallet address and defaults to Arc testnet with both rails', () => {
    const cp = new ChainPe({ privateKey: TEST_KEY })
    expect(cp.getAddress().toLowerCase()).toBe(TEST_ADDR.toLowerCase())
    expect(cp.network).toBe('arc-testnet')
    expect(cp.rails).toEqual(['gateway', 'exact'])
    expect(cp.accountsAddress).toBe('0xD315322c9D83A6f50A04236A2a242e0259bfB580')
    expect(cp.reputationRegistry).toBe('0x8004B663056A597Dffe9eCcC1965A193B7388713')
    expect(cp.config.maxPerCall).toBe('1')
  })

  it('uses the mainnet registry on arc, where ChainPeAccounts is not deployed', () => {
    const cp = new ChainPe({ privateKey: TEST_KEY, network: 'arc' })
    expect(cp.accountsAddress).toBeUndefined()
    expect(cp.reputationRegistry).toBe('0x8004BAa17C55a88189AE136b182e5fdA19dE9b63')
  })

  it('rejects other networks and rails', () => {
    // @ts-expect-error intentional misuse
    expect(() => new ChainPe({ privateKey: TEST_KEY, network: 'base' })).toThrow(/Invalid network/)
    // @ts-expect-error intentional misuse
    expect(() => new ChainPe({ privateKey: TEST_KEY, rails: ['card'] })).toThrow(/Invalid rail/)
  })
})

describe('railPolicy', () => {
  const offers = [exact(), gateway()] as never[]

  it('prefers Gateway only when the deposit covers the price', () => {
    const policy = railPolicy(['gateway', 'exact'], 10000n)
    expect(policy(2, offers)).toEqual([gateway()])
    expect(railPolicy(['gateway', 'exact'], 9999n)(2, offers)).toEqual([exact()])
  })

  it('follows the order and the rails it is given', () => {
    expect(railPolicy(['exact', 'gateway'], 10000n)(2, offers)).toEqual([exact()])
    expect(railPolicy(['exact'], 10000n)(2, [gateway()] as never[])).toEqual([])
    expect(railPolicy(['gateway'], 0n)(2, offers)).toEqual([])
  })
})

describe('ChainPe.fetch / pay', () => {
  it('passes non-402 responses straight through (no payment)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ hello: 'world' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )
    const cp = new ChainPe({ privateKey: TEST_KEY })
    const spy = vi.spyOn(cp as never, 'gatewayAvailable' as never)
    const result = await cp.pay<{ hello: string }>('https://api.example.com/free')
    expect(result.ok).toBe(true)
    expect(result.data.hello).toBe('world')
    expect(result.payment).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it('pays on the exact rail and reports the transaction', async () => {
    const calls = stubFlow(paymentRequired([exact()], { 'X-CHAINPE-AGENT-ID': '897796' }))
    const cp = new ChainPe({ privateKey: TEST_KEY, rails: ['exact'] })
    const result = await cp.pay<{ hello: string }>(URL_PAID)

    expect(calls).toHaveLength(2)
    expect(calls[0].headers.get('PAYMENT-SIGNATURE')).toBeNull()
    expect(calls[1].headers.get('PAYMENT-SIGNATURE')).toBeTruthy()
    expect(result.data.hello).toBe('world')
    expect(result.payment).toMatchObject({
      amount: '0.01',
      recipient: PAY_TO,
      network: 'arc-testnet',
      rail: 'exact',
      txHash: TX
    })
  })

  it('pays from the Gateway deposit when it covers the price', async () => {
    const transfer = '393435a2-78e7-45c3-bfd8-9f85d7b87930'
    const calls = stubFlow(paymentRequired([exact(), gateway()]), paid(transfer))
    const cp = new ChainPe({ privateKey: TEST_KEY })
    vi.spyOn(cp as never, 'gatewayAvailable' as never).mockResolvedValue(10000n as never)
    const result = await cp.pay(URL_PAID)

    expect(calls[1].headers.get('PAYMENT-SIGNATURE')).toBeTruthy()
    expect(result.payment).toMatchObject({ rail: 'gateway', transferId: transfer })
    expect(result.payment?.txHash).toBeUndefined()
  })

  it('falls back to the wallet when the deposit is too small', async () => {
    stubFlow(paymentRequired([exact(), gateway()]))
    const cp = new ChainPe({ privateKey: TEST_KEY })
    vi.spyOn(cp as never, 'gatewayAvailable' as never).mockResolvedValue(1n as never)
    expect((await cp.pay(URL_PAID)).payment?.rail).toBe('exact')
  })

  it('refuses a price above maxPerCall before signing', async () => {
    const calls = stubFlow(paymentRequired([exact('5000000')]))
    const cp = new ChainPe({ privateKey: TEST_KEY, rails: ['exact'], maxPerCall: '1' })
    await expect(cp.fetch(URL_PAID)).rejects.toThrow(/exceeds maxPerCall/)
    expect(calls).toHaveLength(1)
  })

  it('errors when the server only accepts other networks', async () => {
    const calls = stubFlow(paymentRequired([exact('10000', 'eip155:8453')]))
    const cp = new ChainPe({ privateKey: TEST_KEY, rails: ['exact'] })
    await expect(cp.fetch(URL_PAID)).rejects.toThrow(/does not accept payment on arc-testnet/)
    expect(calls).toHaveLength(1)
  })

  it('explains a Gateway-only price with no deposit, and signs nothing', async () => {
    const calls = stubFlow(paymentRequired([gateway()]))
    const cp = new ChainPe({ privateKey: TEST_KEY })
    vi.spyOn(cp as never, 'gatewayAvailable' as never).mockResolvedValue(0n as never)
    await expect(cp.fetch(URL_PAID)).rejects.toThrow(/needs a Gateway deposit/)
    expect(calls).toHaveLength(1)
  })

  it('throws when the server refuses the signed payment', async () => {
    stubFlow(
      paymentRequired([exact()]),
      new Response(JSON.stringify({ error: 'payment_failed', reason: 'insufficient_funds' }), {
        status: 402,
        headers: { 'content-type': 'application/json' }
      })
    )
    const cp = new ChainPe({ privateKey: TEST_KEY, rails: ['exact'] })
    const failure = await cp.fetch(URL_PAID).catch(err => err)
    expect(failure).toBeInstanceOf(ChainPePaymentError)
    expect(failure.reason).toBe('insufficient_funds')
  })

  it('rejects a bad deposit amount before touching Gateway', async () => {
    const cp = new ChainPe({ privateKey: TEST_KEY })
    await expect(cp.depositGateway('-1')).rejects.toThrow(/Invalid amount/)
    await expect(cp.depositGateway('0')).rejects.toThrow(/Invalid amount/)
  })
})
