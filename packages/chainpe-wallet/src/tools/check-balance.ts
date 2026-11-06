import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import {
  clientFor,
  errorMessage,
  NO_WALLET_MESSAGE,
  toolError,
  toolJson
} from '@/clients.js'

export function registerCheckBalance(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'check_balance',
    'Check this wallet on Arc: its address, its USDC, and its Circle Gateway deposit. On Arc, gas is paid in USDC.',
    {},
    async () => {
      if (!config.canPay) return toolError(NO_WALLET_MESSAGE)
      try {
        const client = clientFor(config)
        const { usdc, gateway } = await client.balance()
        return toolJson({
          address: client.getAddress(),
          network: config.network,
          mode: config.mode,
          usdc: `${usdc} USDC`,
          gatewayDeposit: `${gateway} USDC`,
          gasNote:
            'Gas on Arc is paid in USDC. x402 payments cost you no gas: Circle pays it on the exact rail, and the Gateway rail has none. Transfers, deposits and ratings do use gas.'
        })
      } catch (err) {
        return toolError(`Error: ${errorMessage(err)}`)
      }
    }
  )
}
