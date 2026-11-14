/** Against viem's real error handling: a revert is an answer, and an outage must never read as one. */
import { createPublicClient, custom, encodeErrorResult, parseAbi, type PublicClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { createChainReader } from '../src/chain.js'
import { hex32 } from './helpers.js'

const env = {
  CHAINPE_REGISTRY_ADDRESS: '0x2a589f1e4e3cd0a3ee986cec5202af3760e3170e',
  ERC8004_IDENTITY_REGISTRY: '0xb1330d7b1b083ba689c7f56bdf667f1f528a3195',
}

function reader(answer: () => unknown) {
  const client = createPublicClient({
    transport: custom({ request: async ({ method }: { method: string }) => (method === 'eth_call' ? answer() : null) }, { retryCount: 0 }),
  }) as PublicClient
  return createChainReader(client, env)
}

const reverted = () => {
  throw Object.assign(new Error('execution reverted'), {
    code: 3,
    data: encodeErrorResult({ abi: parseAbi(['error ServiceNotFound()']), errorName: 'ServiceNotFound' }),
  })
}
const outage = () => {
  throw Object.assign(new Error('rate limit exceeded'), { code: -32005 })
}

describe('chain reader', () => {
  it('reads an unknown service key, which reverts, as no owner', async () => {
    await expect(reader(reverted).serviceProvider(hex32(1) as `0x${string}`)).resolves.toBeNull()
  })

  it('reads a token that does not exist as no owner', async () => {
    await expect(reader(reverted).ownerOf(7n)).resolves.toBeNull()
  })

  it('keeps throwing on an outage, so it cannot read as "not yours"', async () => {
    await expect(reader(outage).serviceProvider(hex32(1) as `0x${string}`)).rejects.toThrow()
    await expect(reader(outage).ownerOf(7n)).rejects.toThrow()
    await expect(reader(outage).findProvider(`0x${'1'.repeat(40)}`)).rejects.toThrow()
  })
})
