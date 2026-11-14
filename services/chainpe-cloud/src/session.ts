/** Session tokens (HS256, 12 h) and the two auth middlewares. */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextFunction, Request, Response } from 'express'
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose'
import { getAddress } from 'viem'
import type { Db } from './db.js'
import { ingestKeys, revokedSessions } from './schema.js'
import { HttpError } from './util.js'

export const SESSION_TTL_SECONDS = 12 * 60 * 60
const ISSUER = 'chainpe-cloud'

declare module 'express-serve-static-core' {
  interface Request {
    /** Lowercase address of the authenticated provider. */
    provider?: string
    session?: { jti: string; expiresAt: Date }
    ingestKeyId?: string
  }
}

export interface Sessions {
  issue(address: string): Promise<{ token: string; expiresAt: Date }>
  requireSession(req: Request, res: Response, next: NextFunction): void
}

const unauthorized = (message: string) => new HttpError(401, 'unauthorized', message)

function bearer(req: Request): string {
  const header = req.headers.authorization ?? ''
  if (!header.startsWith('Bearer ')) throw unauthorized('Send Authorization: Bearer <token>.')
  return header.slice('Bearer '.length).trim()
}

export function createSessions(db: Db, secret: string, now: () => number = Date.now): Sessions {
  const key = new TextEncoder().encode(secret)

  async function authenticate(req: Request): Promise<void> {
    let payload
    try {
      ;({ payload } = await jwtVerify(bearer(req), key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        currentDate: new Date(now()),
      }))
    } catch (err) {
      if (err instanceof HttpError) throw err
      const expired = err instanceof joseErrors.JWTExpired
      throw unauthorized(expired ? 'Session expired. Sign in again.' : 'Invalid session token.')
    }
    if (!payload.sub || !payload.jti || !payload.exp) throw unauthorized('Invalid session token.')
    const [revoked] = await db.select().from(revokedSessions).where(eq(revokedSessions.jti, payload.jti))
    if (revoked) throw unauthorized('Session ended. Sign in again.')
    req.provider = payload.sub.toLowerCase()
    req.session = { jti: payload.jti, expiresAt: new Date(payload.exp * 1000) }
  }

  return {
    async issue(address) {
      const issued = Math.floor(now() / 1000)
      const exp = issued + SESSION_TTL_SECONDS
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(ISSUER)
        .setSubject(getAddress(address))
        .setJti(randomUUID())
        .setIssuedAt(issued)
        .setExpirationTime(exp)
        .sign(key)
      return { token, expiresAt: new Date(exp * 1000) }
    },
    requireSession(req, _res, next) {
      authenticate(req).then(() => next(), next)
    },
  }
}

// ---------------------------------------------------------------- ingest keys

export const hashKey = (key: string): string => createHash('sha256').update(key).digest('hex')

/** 256 bits of randomness. Only its hash is stored, so it can be shown exactly once. */
export function newIngestKey(): { key: string; hash: string; prefix: string } {
  const key = `cpk_${randomBytes(32).toString('base64url')}`
  return { key, hash: hashKey(key), prefix: key.slice(0, 10) }
}

export function requireIngestKey(db: Db) {
  async function authenticate(req: Request): Promise<void> {
    const key = bearer(req)
    if (!key.startsWith('cpk_')) throw unauthorized('Send an ingest key: Bearer cpk_…')
    const [row] = await db
      .select({ id: ingestKeys.id, provider: ingestKeys.provider })
      .from(ingestKeys)
      .where(and(eq(ingestKeys.keyHash, hashKey(key)), isNull(ingestKeys.revokedAt)))
    if (!row) throw unauthorized('Unknown or revoked ingest key.')
    req.provider = row.provider
    req.ingestKeyId = row.id
    await db.update(ingestKeys).set({ lastUsedAt: new Date() }).where(eq(ingestKeys.id, row.id))
  }
  return (req: Request, _res: Response, next: NextFunction): void => {
    authenticate(req).then(() => next(), next)
  }
}
