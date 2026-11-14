/** REST query API over the indexed data — makes discovery + reputation O(1). */
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import type { Db } from './db.js'
import {
  listActiveServices,
  getFeedbackForAgents,
  getCursor,
  counts,
  type ServiceRecord,
  type FeedbackRecord
} from './store.js'
import {
  aggregateReputation,
  rankServices,
  type ReputationSummary
} from './core.js'
import { getIndexerHead } from './indexer.js'
import { NETWORK } from './config.js'

interface ServiceDto {
  id: string
  key: string
  name: string
  description: string
  tags: string[]
  endpoint: string
  pricePerRequest: string
  paymentToken: string
  walletAddress: string
  developer: string
  network: string
  agentId?: string
  reputation: ReputationSummary | null
}

function tagsToArray(tags: string): string[] {
  return tags
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
}

async function reputationByAgent(
  db: Db,
  records: ServiceRecord[]
): Promise<Map<string, ReputationSummary>> {
  const agentIds = [
    ...new Set(records.map(s => s.agentId).filter((id): id is string => !!id))
  ]
  const rows = await getFeedbackForAgents(db, agentIds)
  const grouped = new Map<string, FeedbackRecord[]>()
  for (const r of rows) {
    const arr = grouped.get(r.agentId) ?? []
    arr.push(r)
    grouped.set(r.agentId, arr)
  }
  const map = new Map<string, ReputationSummary>()
  for (const id of agentIds) {
    map.set(id, aggregateReputation(grouped.get(id) ?? []))
  }
  return map
}

function toDto(s: ServiceRecord, reputation: ReputationSummary | null): ServiceDto {
  return {
    id: `${s.developer}:${s.name}`,
    key: s.key,
    name: s.name,
    description: s.description,
    tags: tagsToArray(s.tags),
    endpoint: s.endpoint,
    pricePerRequest: s.pricePerRequest,
    paymentToken: s.paymentToken,
    walletAddress: s.payTo,
    developer: s.developer,
    network: NETWORK,
    agentId: s.agentId ?? undefined,
    reputation
  }
}

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' }
})

export function createApi(db: Db) {
  const app = express()
  // Railway puts exactly one proxy in front; without this every client shares one IP
  // and the rate limiter either blocks everyone or nobody.
  app.set('trust proxy', 1)
  app.use(cors())
  app.use(apiLimiter)

  app.get('/health', async (_req: Request, res: Response) => {
    const cursor = await getCursor(db).catch(() => null)
    res.json({
      status: 'ok',
      service: 'chainpe-indexer',
      network: NETWORK,
      lastIndexedBlock: cursor != null ? cursor.toString() : null,
      chainHead: getIndexerHead().toString()
    })
  })

  app.get('/stats', async (_req: Request, res: Response) => {
    const c = await counts(db)
    res.json({ services: c.services, feedback: c.feedback, network: NETWORK })
  })

  app.get('/services', async (req: Request, res: Response) => {
    const MAX_PAGE = 100
    try {
      const records = await listActiveServices(db)
      const repMap = await reputationByAgent(db, records)
      let items = records.map(s =>
        toDto(s, s.agentId ? (repMap.get(s.agentId) ?? null) : null)
      )

      const query = (req.query.query as string | undefined)?.toLowerCase()
      if (query) {
        items = items.filter(
          s =>
            s.name.toLowerCase().includes(query) ||
            s.description.toLowerCase().includes(query) ||
            s.tags.some(t => t.toLowerCase().includes(query))
        )
      }
      const tag = req.query.tag as string | undefined
      if (tag) {
        items = items.filter(s =>
          s.tags.some(t => t.toLowerCase() === tag.toLowerCase())
        )
      }
      const maxPrice = req.query.maxPrice as string | undefined
      if (maxPrice) {
        const max = parseFloat(maxPrice)
        items = items.filter(s => parseFloat(s.pricePerRequest) <= max)
      }

      const ranked = rankServices(items)

      // Pagination: cap at 100 per page to prevent OOM on large registries.
      const offset = Math.max(0, parseInt((req.query.offset as string) ?? '0', 10) || 0)
      const limit = Math.min(MAX_PAGE, Math.max(1, parseInt((req.query.limit as string) ?? String(MAX_PAGE), 10) || MAX_PAGE))
      const page = ranked.slice(offset, offset + limit)

      res.json({ total: ranked.length, offset, limit, items: page })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  app.get('/services/:id', async (req: Request, res: Response) => {
    const records = await listActiveServices(db)
    const match = records.find(
      s => s.key === req.params.id || `${s.developer}:${s.name}` === req.params.id
    )
    if (!match) return res.status(404).json({ error: 'service not found' })
    const repMap = await reputationByAgent(db, [match])
    res.json(toDto(match, match.agentId ? (repMap.get(match.agentId) ?? null) : null))
  })

  app.get('/services/:id/reputation', async (req: Request, res: Response) => {
    const records = await listActiveServices(db)
    const match = records.find(
      s => s.key === req.params.id || `${s.developer}:${s.name}` === req.params.id
    )
    if (!match) return res.status(404).json({ error: 'service not found' })
    if (!match.agentId) return res.json({ count: 0, score: null })
    const rows = await getFeedbackForAgents(db, [match.agentId])
    res.json(aggregateReputation(rows))
  })

  return app
}
