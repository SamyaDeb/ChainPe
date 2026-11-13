import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import { getWalletAddress, getUsdcBalance, getAvaxBalance } from '@/clients.js'

export function registerCheckBalance(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'check_balance',
    'Check wallet balances: USDC and native AVAX (for gas) on Avalanche Fuji/Mainnet.',
    {},
    async () => {
      if (!config.canPay) {
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
        const address = getWalletAddress(config)
        const [usdc, avax] = await Promise.all([
          getUsdcBalance(config.network, config),
          getAvaxBalance(config.network, address)
        ])

        const result = {
          address,
          network: config.network,
          mode: config.mode,
          usdc: `${usdc} USDC`,
          avax: `${avax} AVAX`,
          gasNote:
            'AVAX is needed for native transfers and gas. x402 USDC payments are gasless for you — the facilitator pays gas.'
        }

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) }
          ]
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}
