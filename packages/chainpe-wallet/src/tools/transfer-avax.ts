/**
 * transfer_avax — Send native AVAX from the agent wallet to any address.
 *
 * Unlike transfer_usdc (which moves an ERC-20), this moves the native Avalanche
 * currency. Use it to pay gas for another wallet or move value in AVAX.
 */
import { z } from 'zod'
import { createWalletClient, http, getAddress, parseEther } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig, PaymentNetwork } from '@/types.js'
import { rpcUrlFor, publicClientFor } from '@/clients.js'

const CHAINS = { fuji: avalancheFuji, avalanche }

function explorerTx(network: PaymentNetwork, hash: string): string {
  return network === 'fuji'
    ? `https://testnet.snowtrace.io/tx/${hash}`
    : `https://snowtrace.io/tx/${hash}`
}

export function registerTransferAvax(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'transfer_avax',
    'Send native AVAX from this agent wallet to another address. Use this to pay for gas, seed a new ' +
      'wallet, or transfer value in AVAX. For USDC transfers, use transfer_usdc instead.',
    {
      to: z.string().describe('Recipient EVM address (0x…)'),
      amount: z
        .string()
        .describe('Amount of AVAX as decimal string, e.g. "1.5"'),
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
              text: 'No wallet configured. Set CHAINPE_PRIVATE_KEY.'
            }
          ],
          isError: true
        }
      }

      try {
        const net = network as PaymentNetwork
        const account = privateKeyToAccount(normalizeKey(config.privateKey))
        const walletClient = createWalletClient({
          account,
          chain: CHAINS[net],
          transport: http(rpcUrlFor(net))
        })

        const value = parseEther(amount)
        if (value <= 0n) {
          return {
            content: [
              { type: 'text' as const, text: 'Amount must be greater than 0.' }
            ],
            isError: true
          }
        }

        const recipient = getAddress(to)
        const hash = await walletClient.sendTransaction({
          to: recipient,
          value
        })
        const receipt = await publicClientFor(net).waitForTransactionReceipt({
          hash
        })

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
                  amount: `${amount} AVAX`,
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
