/**
 * request_funding — ask a human (or another agent) to top up this wallet with
 * USDC on Arc, with an EIP-681 link and, on testnet, the faucet.
 *
 *   USDC:  ethereum:<usdc>@<chainId>/transfer?address=<wallet>&uint256=<atomic>
 */
import { z } from 'zod'
import { parseUnits } from 'viem'
import { chainFor, getUsdcAddress, USDC_DECIMALS } from '@chainpearc/sdk'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import {
  clientFor,
  errorMessage,
  NO_WALLET_MESSAGE,
  toolError,
  toolJson
} from '@/clients.js'

export function registerRequestFunding(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'request_funding',
    'Ask a human or another agent to send USDC to this wallet on Arc, with a payment link and plain ' +
      'address. On Arc testnet it points to the free faucet. Use this when the wallet is low on funds.',
    {
      amount: z
        .string()
        .describe('USDC amount to request as decimal, e.g. "5.00"')
    },
    async ({ amount }) => {
      if (!config.canPay) return toolError(NO_WALLET_MESSAGE)
      try {
        const address = clientFor(config).getAddress()
        const chainId = chainFor(config.network).id
        const atomic = parseUnits(amount, USDC_DECIMALS)
        const testnet = config.network === 'arc-testnet'
        return toolJson({
          message: `Please send ${amount} USDC to fund this agent wallet.`,
          walletAddress: address,
          currency: 'USDC',
          amount: `${amount} USDC`,
          network: config.network,
          chainId,
          paymentUri: `ethereum:${getUsdcAddress(config.network)}@${chainId}/transfer?address=${address}&uint256=${atomic}`,
          instructions: testnet
            ? [
                'Get free test USDC at https://faucet.circle.com: pick Arc Testnet and paste walletAddress',
                'On Arc, this USDC also pays for gas'
              ]
            : [
                'Open the paymentUri in an EVM wallet to prefill the transfer',
                'Or copy walletAddress and send USDC on Arc'
              ]
        })
      } catch (err) {
        return toolError(`Error: ${errorMessage(err)}`)
      }
    }
  )
}
