/** Against viem's real error handling: a revert is an answer, and an outage must never read as one. */
import { createPublicClient, custom, encodeErrorResult, parseAbi, type PublicClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { createChainReader } from '../src/chain.js'
import { hex32 } from './helpers.js'

const env = {
  CHAINPE_ACCOUNTS_ADDRESS: '0xd315322c9d83a6f50a04236a2a242e0259bfb580',
  ERC8004_IDENTITY_REGISTRY: '0x8004a818bfb912233c491871b3d84c89a494bd9e',
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
  })
})
