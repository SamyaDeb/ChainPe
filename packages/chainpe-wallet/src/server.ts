import os from 'node:os'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { privateKeyToAccount } from 'viem/accounts'
import { normalizeKey } from '@chainpearc/sdk'
import type { AppConfig } from '@/types.js'
import { SpendingTracker } from '@/spending.js'
import { registerCheckBalance } from '@/tools/check-balance.js'
import { registerDepositGateway } from '@/tools/deposit-gateway.js'
import { registerPay } from '@/tools/pay.js'
import { registerX402Fetch } from '@/tools/x402-fetch.js'
import { registerTransferUsdc } from '@/tools/transfer-usdc.js'
import { registerBazaarSearch } from '@/tools/bazaar-search.js'
import { registerRequestFunding } from '@/tools/request-funding.js'
import { registerSpendingReport } from '@/tools/spending-report.js'
import { registerGiveFeedback } from '@/tools/give-feedback.js'

export function createMcpServer(config: AppConfig): McpServer {
  const server = new McpServer({
    name: 'chainpe-wallet',
    version: '0.4.0'
  })

  const spending = new SpendingTracker(config.budget, spendingFile(config))

  // Core wallet, on Arc
  registerCheckBalance(server, config)
  registerTransferUsdc(server, config, spending)
  registerDepositGateway(server, config)

  // x402 payments
  registerPay(server, config, spending)
  registerX402Fetch(server, config, spending)

  // Budget and funding
  registerSpendingReport(server, spending)
  registerRequestFunding(server, config)

  // Discovery
  registerBazaarSearch(server, config)

  // On-chain reputation (ERC-8004)
  registerGiveFeedback(server, config)

  return server
}

/**
 * Where today's spending is saved, one file per wallet and network, so a restart
 * does not reset the daily limit. CHAINPE_SPENDING_FILE overrides it.
 */
export function spendingFile(config: AppConfig): string | undefined {
  if (process.env.CHAINPE_SPENDING_FILE)
    return process.env.CHAINPE_SPENDING_FILE
  if (!config.privateKey) return undefined
  const address = privateKeyToAccount(
    normalizeKey(config.privateKey)
  ).address.toLowerCase()
  return path.join(
    os.homedir(),
    '.chainpe',
    `spending-${config.network}-${address}.json`
  )
}
