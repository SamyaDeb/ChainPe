import { z } from 'zod'
import {
  createWalletClient,
  http,
  erc20Abi,
  getAddress,
  parseUnits
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  chainFor,
  explorerFor,
  getUsdcAddress,
  normalizeKey,
  publicClientFor,
  rpcUrlFor,
  USDC_DECIMALS
} from '@chainpearc/sdk'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import type { SpendingTracker } from '@/spending.js'
import {
  errorMessage,
  NO_WALLET_MESSAGE,
  toolError,
  toolJson
} from '@/clients.js'

export function registerTransferUsdc(
  server: McpServer,
  config: AppConfig,
  spending: SpendingTracker
): void {
  server.tool(
    'transfer_usdc',
    'Send USDC directly on-chain from this wallet to another address on Arc. This is a real ERC-20 ' +
      'transfer, not an x402 payment. Use it to send USDC to someone, top up a wallet, or move funds.',
    {
      to: z.string().describe('Recipient EVM address (0x…)'),
      amount: z.string().describe('USDC amount as decimal string, e.g. "1.50"')
    },
    async ({ to, amount }) => {
      if (!config.privateKey) return toolError(NO_WALLET_MESSAGE)
      try {
        spending.check(amount)

        // Through the 6-decimal ERC-20 interface, never Arc's 18-decimal native balance.
        const value = parseUnits(amount, USDC_DECIMALS)
        if (value <= 0n) return toolError('Amount must be greater than 0.')

        const net = config.network
        const account = privateKeyToAccount(normalizeKey(config.privateKey))
        const walletClient = createWalletClient({
          account,
          chain: chainFor(net),
          transport: http(rpcUrlFor(net))
        })
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
        if (receipt.status === 'success')
          spending.record(amount, recipient, net)

        return toolJson({
          success: receipt.status === 'success',
          txHash: hash,
          from: account.address,
          to: recipient,
          amount: `${amount} USDC`,
          network: net,
          blockNumber: Number(receipt.blockNumber),
          explorerUrl: `${explorerFor(net)}/tx/${hash}`
        })
      } catch (err) {
        return toolError(`Transfer failed: ${errorMessage(err)}`)
      }
    }
  )
}
