/**
 * ChainPe MCP Server — general-purpose A2A commerce for Claude Desktop.
 *
 * Exposes the ChainPe marketplace as MCP tools so any AI client (Claude Desktop,
 * Cursor, etc.) can discover agents, read their descriptions, and pay them in
 * USDC via x402 — without knowing anything about payment channels upfront.
 *
 * Tools:
 *   discover      — search the marketplace for agents
 *   call_agent    — pay & call any agent endpoint (GET or POST)
 *   wallet_balance — check buyer wallet USDC + AVAX
 *   rate_agent    — give ERC-8004 reputation feedback
 *   payment_history — session payment log
 *
 * Configure in Claude Desktop:
 *   ~/Library/Application Support/Claude/claude_desktop_config.json
 *   {
 *     "mcpServers": {
 *       "chainpe": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/chainpe-mcp.mjs"],
 *         "env": {
 *           "CHAINPE_PRIVATE_KEY": "0x...",
 *           "CHAINPE_NETWORK": "fuji"
 *         }
 *       }
 *     }
 *   }
 */
import 'dotenv/config'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ChainPe } from '@chainpe/sdk'

// ── Init ────────────────────────────────────────────────────────────────────

const privateKey = process.env.CHAINPE_PRIVATE_KEY
if (!privateKey) {
  process.stderr.write('ChainPe MCP: CHAINPE_PRIVATE_KEY env var is required.\n')
  process.exit(1)
}

const cp = new ChainPe({
  privateKey,
  network: process.env.CHAINPE_NETWORK ?? 'fuji',
  autoFeedback: false, // caller controls when to rate (use rate_agent tool)
  maxPerCall: process.env.CHAINPE_MAX_PER_CALL ?? '2.00',
})

// In-memory payment ledger for this session
const payments = []

// ── MCP server ──────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: 'chainpe', version: '1.0.0' },
  {
    capabilities: { tools: {} },
  }
)

// ── Tool: discover ──────────────────────────────────────────────────────────

server.tool(
  'discover',
  `Search the ChainPe marketplace for AI agents that sell API access for USDC.
Returns each agent's name, description, tags, endpoint URL, price per call,
and ERC-8004 reputation score. Use this first to find the right agent for a task,
then use call_agent to hire it.`,
  {
    query: z
      .string()
      .optional()
      .describe('Free-text search over name, description, and tags (e.g. "price data", "image generation")'),
    tags: z
      .array(z.string())
      .optional()
      .describe('Filter by exact tag match (e.g. ["avax", "defi"])'),
    max_price_usdc: z
      .string()
      .optional()
      .describe('Only return agents charging at most this amount per call (e.g. "0.10")'),
  },
  async ({ query, tags, max_price_usdc }) => {
    try {
      const services = await cp.discover({
        query,
        tags,
        maxPrice: max_price_usdc,
      })

      if (services.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No agents found on the ChainPe marketplace matching those criteria.',
            },
          ],
        }
      }

      // Enrich each service with its live schema (free /chainpe-admin/schema endpoint)
      const enriched = await Promise.all(
        services.map(async (s) => {
          let schema = null
          try {
            const r = await fetch(`${s.endpoint}/chainpe-admin/schema`, { signal: AbortSignal.timeout(3000) })
            if (r.ok) schema = await r.json()
          } catch { /* agent not reachable or no schema */ }
          return { ...s, schema }
        })
      )

      const rows = enriched.map((s, i) => {
        const rep = s.reputation
          ? `⭐ ${s.reputation.score ?? '?'} (${s.reputation.count} ratings)`
          : 'unrated'
        const tagStr = (s.tags ?? []).join(', ') || '—'
        const live = s.schema ? '🟢 live' : '🔴 offline'

        const routeLines = (s.schema?.routes ?? []).map(
          (r) => `  - \`${r.method} ${s.endpoint}${r.path}\`${r.paid ? ' 💰' : ' (free)'} — ${r.description}`
        )

        return [
          `### ${i + 1}. ${s.name}  [${live}]`,
          `- **Base endpoint**: ${s.endpoint}`,
          `- **Price**: $${s.pricePerRequest} USDC per call`,
          `- **Reputation**: ${rep}`,
          `- **Tags**: ${tagStr}`,
          `- **Description**: ${s.description}`,
          `- **Agent ID**: ${s.agentId ?? 'none'}`,
          routeLines.length > 0
            ? `- **Routes** (call these with call_agent):\n${routeLines.join('\n')}`
            : `- **Routes**: call GET ${s.endpoint}/chainpe-admin/schema to discover`,
        ].join('\n')
      })

      return {
        content: [
          {
            type: 'text',
            text:
              `Found **${services.length}** agent(s) on ChainPe marketplace ` +
              `(network: ${cp.network ?? 'fuji'}, buyer: ${cp.getAddress()}):\n\n` +
              rows.join('\n\n'),
          },
        ],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Discovery failed: ${err.message}` }],
        isError: true,
      }
    }
  }
)

// ── Tool: call_agent ────────────────────────────────────────────────────────

server.tool(
  'call_agent',
  `Pay and call any ChainPe agent endpoint using x402 USDC micropayments.
The payment is handled automatically — just provide the endpoint and what to send.
The buyer wallet pays the agent in USDC on Avalanche Fuji (or mainnet).
Returns the agent's response data, the payment receipt, and any reputation update.

Use discover first to find agent endpoints and understand what body to send.`,
  {
    endpoint: z
      .string()
      .url()
      .describe('Full URL of the agent endpoint (e.g. "http://localhost:4503/price")'),
    method: z
      .enum(['GET', 'POST', 'PUT', 'DELETE'])
      .default('GET')
      .describe('HTTP method. Use POST when sending a request body.'),
    body: z
      .record(z.unknown())
      .optional()
      .describe(
        'JSON body to send (for POST/PUT). Shape depends on the agent — read its description from discover.'
      ),
    headers: z
      .record(z.string())
      .optional()
      .describe('Extra HTTP headers (rarely needed; content-type is auto-set for JSON bodies)'),
    timeout_ms: z
      .number()
      .int()
      .min(1000)
      .max(120000)
      .default(60000)
      .describe('Request timeout in milliseconds (default 60s)'),
    auto_rate: z
      .boolean()
      .default(true)
      .describe(
        'When true, post ERC-8004 positive feedback after a successful paid call. Set false to rate manually.'
      ),
  },
  async ({ endpoint, method, body, headers, timeout_ms, auto_rate }) => {
    try {
      const fetchOpts = {
        method,
        timeout: timeout_ms,
        autoFeedback: auto_rate,
      }

      if (body !== undefined) {
        fetchOpts.body = JSON.stringify(body)
        fetchOpts.headers = {
          'content-type': 'application/json',
          ...(headers ?? {}),
        }
      } else if (headers) {
        fetchOpts.headers = headers
      }

      const result = await cp.pay(endpoint, fetchOpts)

      // Log to in-memory ledger
      const entry = {
        ts: new Date().toISOString(),
        endpoint,
        method,
        status: result.status,
        paid: result.payment?.amount ?? '0',
        recipient: result.payment?.recipient ?? null,
        txHash: result.payment?.txHash ?? null,
        rated: !!result.reputation,
      }
      payments.push(entry)

      // Build human-readable response
      const lines = []

      if (!result.ok) {
        lines.push(`**Error ${result.status}** from agent:`)
        lines.push('```json')
        lines.push(JSON.stringify(result.data, null, 2))
        lines.push('```')
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          isError: true,
        }
      }

      // Payment receipt
      if (result.payment) {
        const tx = result.payment.txHash
          ? `\n  - tx: https://testnet.snowtrace.io/tx/${result.payment.txHash}`
          : ''
        lines.push(
          `**Paid**: ${result.payment.amount} USDC → \`${result.payment.recipient}\`${tx}`
        )
      } else {
        lines.push('**Free call** (no payment required)')
      }

      // Reputation
      if (result.reputation) {
        lines.push(
          `**Rated**: agent #${result.reputation.agentId} +${result.reputation.score} ⭐` +
            (result.reputation.txHash ? ` (tx: ${result.reputation.txHash.slice(0, 10)}…)` : '')
        )
      }

      lines.push('')
      lines.push('**Response:**')
      lines.push('```json')
      lines.push(JSON.stringify(result.data, null, 2))
      lines.push('```')

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    } catch (err) {
      const isPaymentErr = err?.name === 'ChainPePaymentError'
      const msg = isPaymentErr
        ? `Payment failed: ${err.message}${err.txHash ? ` (tx: ${err.txHash})` : ''}`
        : `Call failed: ${err.message}`
      return {
        content: [{ type: 'text', text: msg }],
        isError: true,
      }
    }
  }
)

// ── Tool: wallet_balance ────────────────────────────────────────────────────

server.tool(
  'wallet_balance',
  'Check the buyer wallet USDC and AVAX balance on the ChainPe network. ' +
    'Use this before running expensive workflows to confirm you have enough funds.',
  {},
  async () => {
    try {
      const bal = await cp.balance()
      const addr = cp.getAddress()
      const network = process.env.CHAINPE_NETWORK ?? 'fuji'
      const explorer =
        network === 'fuji'
          ? `https://testnet.snowtrace.io/address/${addr}`
          : `https://snowtrace.io/address/${addr}`

      const spent = payments.reduce((s, p) => s + Number(p.paid ?? 0), 0)

      return {
        content: [
          {
            type: 'text',
            text: [
              `**Buyer wallet**: \`${addr}\``,
              `**Network**: ${network}`,
              `**USDC balance**: ${bal.usdc} USDC`,
              `**AVAX balance**: ${bal.avax} AVAX`,
              `**Spent this session**: $${spent.toFixed(4)} USDC (${payments.length} calls)`,
              `**Explorer**: ${explorer}`,
            ].join('\n'),
          },
        ],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Balance check failed: ${err.message}` }],
        isError: true,
      }
    }
  }
)

// ── Tool: rate_agent ────────────────────────────────────────────────────────

server.tool(
  'rate_agent',
  'Post ERC-8004 reputation feedback for a ChainPe agent on-chain. ' +
    'Call this after using an agent to leave a score. Scores accumulate on-chain ' +
    'and are used to rank agents in future discover calls.',
  {
    agent_id: z
      .number()
      .int()
      .positive()
      .describe('Numeric ERC-8004 agent ID shown in discover output'),
    score: z
      .number()
      .int()
      .min(0)
      .max(100)
      .default(100)
      .describe('Reputation score 0–100 (100 = excellent, 0 = failed badly)'),
  },
  async ({ agent_id, score }) => {
    try {
      const result = await cp.giveFeedback(agent_id, score)
      return {
        content: [
          {
            type: 'text',
            text: [
              `**Rated** agent #${agent_id}: +${score} ⭐`,
              result?.txHash
                ? `tx: https://testnet.snowtrace.io/tx/${result.txHash}`
                : '(no tx hash returned)',
            ].join('\n'),
          },
        ],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Rating failed: ${err.message}` }],
        isError: true,
      }
    }
  }
)

// ── Tool: payment_history ───────────────────────────────────────────────────

server.tool(
  'payment_history',
  'Show all agent payments made in this MCP session: endpoint, amount paid, tx hash, and whether the agent was rated.',
  {
    limit: z.number().int().min(1).max(100).default(20).describe('Max rows to return'),
  },
  async ({ limit }) => {
    const rows = payments.slice(-limit)

    if (rows.length === 0) {
      return {
        content: [{ type: 'text', text: 'No payments made yet this session.' }],
      }
    }

    const total = rows.reduce((s, p) => s + Number(p.paid ?? 0), 0)

    const lines = rows.map((p, i) => {
      const tx = p.txHash ? ` · [tx](https://testnet.snowtrace.io/tx/${p.txHash})` : ''
      const rated = p.rated ? ' ⭐' : ''
      return `${i + 1}. \`${p.method} ${p.endpoint}\` — **$${p.paid} USDC**${tx}${rated} · ${p.ts}`
    })

    return {
      content: [
        {
          type: 'text',
          text:
            `**${rows.length} payment(s)** · total $${total.toFixed(4)} USDC this session:\n\n` +
            lines.join('\n'),
        },
      ],
    }
  }
)

// ── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)

process.stderr.write(
  `ChainPe MCP server started (network: ${process.env.CHAINPE_NETWORK ?? 'fuji'}, ` +
    `buyer: ${cp.getAddress()})\n`
)
