/** The HTTP app. Takes everything it talks to, so tests run it against a real database and a stand-in chain. */
import path from 'node:path'
import cors from 'cors'
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { sql } from 'drizzle-orm'
import type { ChainReader } from './chain.js'
import type { Db } from './db.js'
import type { ProviderViews } from './plan.js'
import { authRoutes } from './routes/auth.js'
import { ingestRoutes } from './routes/ingest.js'
import { meRoutes } from './routes/me.js'
import { publicRoutes } from './routes/public.js'
import { publicProviderRoutes } from './routes/publicProvider.js'
import { requireIngestKey, type Sessions } from './session.js'
import { HttpError, safeMessage } from './util.js'

export interface Limits {
  nonce: number
  verify: number
  ingestKey: number
  ingestIp: number
  read: number
  /** Per IP, for the unauthenticated /v1/public reads. */
  public?: number
  /** Per IP, for the sample provider summary, which runs heavier queries than the other public reads. */
  sampleProvider?: number
}

export const DEFAULT_LIMITS: Limits = { nonce: 20, verify: 10, ingestKey: 600, ingestIp: 1200, read: 300, public: 120, sampleProvider: 30 }

export interface AppOptions {
  db: Db
  chain: ChainReader
  sessions: Sessions
  views: ProviderViews
  corsOrigins: string[]
  /** Extra origins allowed to read /v1/public (the landing site). chainpe.vercel.app is always allowed. */
  publicCorsOrigins?: string[]
  /** Providers whose aggregate summary is public (SAMPLE_PROVIDERS). Any other address gets a 404. */
  sampleProviders?: string[]
  chainId: number
  dashboardDomain: string | string[]
  cliDomain: string
  limits?: Limits
  onEvents?: () => void
  indexerStatus?: () => Promise<{ cursor: string; head: string }>
  /** The built dashboard (apps/avalanche-dashboard, built with base /dashboard/). Served at /dashboard when set. */
  dashboardDir?: string
  now?: () => number
}

function limiter(limit: number, key: (req: Request) => string): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: key,
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Slow down and retry.' })
    },
  })
}

/** The landing site. Public reads are always open to it. */
const PUBLIC_SITE_ORIGIN = 'https://chainpe.vercel.app'

const byIp = (req: Request): string => ipKeyGenerator(req.ip ?? 'unknown')

export function createApp(options: AppOptions): express.Express {
  const { db, chain, sessions, views, limits = DEFAULT_LIMITS, now } = options
  const app = express()
  // Railway terminates TLS one hop in front, so the client IP is the last forwarded one.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  // Public reputation reads: no session, their own rate limit and CORS. Mounted before the session-API CORS below,
  // so the landing site (chainpe.vercel.app) and this service's own host can read them from a browser.
  const dashboardHosts = (Array.isArray(options.dashboardDomain) ? options.dashboardDomain : [options.dashboardDomain]).map((d) => `https://${d}`)
  const publicOrigins = [...new Set([PUBLIC_SITE_ORIGIN, ...dashboardHosts, ...options.corsOrigins, ...(options.publicCorsOrigins ?? [])])]
  const publicCors = cors({ origin: publicOrigins, methods: ['GET', 'OPTIONS'], allowedHeaders: ['Content-Type'], credentials: false, maxAge: 600 })
  app.use(
    '/v1/public/providers',
    publicCors,
    publicProviderRoutes({ db, allowlist: options.sampleProviders ?? [], limit: limiter(limits.sampleProvider ?? DEFAULT_LIMITS.sampleProvider!, byIp), now })
  )
  app.use(
    '/v1/public',
    publicCors,
    publicRoutes({ db, limit: limiter(limits.public ?? DEFAULT_LIMITS.public!, byIp) })
  )

  app.use(
    cors({
      origin: options.corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      // A browser hides this from a cross-origin page unless told otherwise, and the dashboard's wait uses it.
      exposedHeaders: ['Retry-After'],
      credentials: false,
      maxAge: 600,
    })
  )
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', async (_req, res) => {
    await db.execute(sql`SELECT 1`)
    const indexer = options.indexerStatus ? await options.indexerStatus() : null
    res.json({ status: 'ok', indexer })
  })

  app.use('/v1/auth/nonce', limiter(limits.nonce, byIp))
  app.use('/v1/auth/verify', limiter(limits.verify, byIp))
  app.use('/v1/ingest', limiter(limits.ingestIp, byIp))

  const requireKey = requireIngestKey(db)
  const perKey = limiter(limits.ingestKey, (req) => req.ingestKeyId ?? byIp(req))
  const guardedKey: RequestHandler = (req, res, next) => {
    requireKey(req, res, (err?: unknown) => (err ? next(err) : perKey(req, res, next)))
  }

  app.use(
    '/v1',
    authRoutes({ db, chain, sessions, chainId: options.chainId, dashboardDomain: options.dashboardDomain, cliDomain: options.cliDomain, now }),
    ingestRoutes({ db, chain, caip2: `eip155:${options.chainId}`, requireKey: guardedKey, onEvents: options.onEvents, now }),
    meRoutes({ db, views, sessions, readLimit: limiter(limits.read, (req) => req.provider ?? byIp(req)), now })
  )

  if (options.dashboardDir) serveDashboard(app, options.dashboardDir)

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'No such endpoint.' })
  })

  // Four arguments, or Express does not treat it as an error handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message })
      return
    }
    const type = (err as { type?: string }).type
    if (type === 'entity.too.large') {
      res.status(413).json({ error: 'payload_too_large', message: 'Request body is over 1 MB.' })
      return
    }
    if (type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_request', message: 'Request body is not valid JSON.' })
      return
    }
    // Only the error, never the request: bodies and headers can hold keys and tokens.
    console.error('request failed:', safeMessage(err))
    res.status(500).json({ error: 'internal_error', message: 'Something went wrong.' })
  })

  return app
}

/**
 * The dashboard is a static single-page app under /dashboard/. Hashed assets are cached for a year; every other
 * path under /dashboard gets index.html, so a reload on /dashboard/payments works. It is never framed.
 */
function serveDashboard(app: express.Express, dir: string): void {
  const root = path.resolve(dir)
  const index = path.join(root, 'index.html')
  const noFrame: RequestHandler = (_req, res, next) => {
    res.set({ 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' })
    next()
  }
  app.get('/', (_req, res) => res.redirect(302, '/dashboard/'))
  app.use('/dashboard/assets', noFrame, express.static(path.join(root, 'assets'), { immutable: true, maxAge: '1y' }))
  app.use('/dashboard', noFrame, express.static(root, { index: false, redirect: false }))
  // A missing hashed asset stays a 404 instead of turning into index.html.
  app.get(/^\/dashboard(?!\/assets\/)(\/.*)?$/, noFrame, (_req, res) => {
    res.set('Cache-Control', 'no-cache')
    res.sendFile(index)
  })
}
