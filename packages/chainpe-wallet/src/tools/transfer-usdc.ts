import { z } from 'zod'
import {
  createWalletClient,
  http,
  erc20Abi,
  getAddress,
  parseUnits
} from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig, PaymentNetwork } from '@/types.js'
import type { SpendingTracker } from '@/spending.js'
import {
  getUsdcAddress,
  rpcUrlFor,
  publicClientFor,
  USDC_DECIMALS
} from '@/clients.js'

const CHAINS = { fuji: avalancheFuji, avalanche }

function explorerTx(network: PaymentNetwork, hash: string): string {
  return network === 'fuji'
    ? `https://testnet.snowtrace.io/tx/${hash}`
    : `https://snowtrace.io/tx/${hash}`
}

export function registerTransferUsdc(
  server: McpServer,
  config: AppConfig,
  spending: SpendingTracker
): void {
  server.tool(
    'transfer_usdc',
    'Send USDC directly on-chain from your Avalanche wallet to another address. This is a real ERC-20 ' +
      'transfer — NOT an x402 payment header. Use it to send USDC to a friend, top up a wallet, or move funds.',
    {
      to: z.string().describe('Recipient EVM address (0x…)'),
      amount: z.string().describe('USDC amount as decimal string, e.g. "1.50"'),
      network: z
        .enum(['fuji', 'avalanche'])
        .default('fuji')
        .describe('Avalanche network (default: fuji)')
    },
    async ({ to, amount, network }) => {
      if (!config.privateKey) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No wallet configured. Set CHAINPE_PRIVATE_KEY environment variable.'
            }
          ],
          isError: true
        }
      }

      try {
        spending.check(amount)

        const net = network as PaymentNetwork
        const account = privateKeyToAccount(normalizeKey(config.privateKey))
        const walletClient = createWalletClient({
          account,
          chain: CHAINS[net],
          transport: http(rpcUrlFor(net))
        })

        const value = parseUnits(amount, USDC_DECIMALS)
        if (value <= 0n) {
          return {
            content: [
              { type: 'text' as const, text: 'Amount must be greater than 0.' }
            ],
            isError: true
          }
        }

        const recipient = getAddress(to)
        const hash = await walletClient.writeContract({
          address: getUsdcAddress(net),
          abi: erc20Abi,
          functionName: 'transfer',
          args: [recipient, value]
        })

        const receipt = await publicClientFor(net).waitForTransactionReceipt({
          hash
        })
        spending.record(amount, recipient, network)

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: receipt.status === 'success',
                  txHash: hash,
                  from: account.address,
                  to: recipient,
                  amount: `${amount} USDC`,
                  network,
                  blockNumber: Number(receipt.blockNumber),
                  explorerUrl: explorerTx(net, hash)
                },
                null,
                2
              )
            }
          ]
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Transfer failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}

function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`
}
