/** SIWE sign-in (EIP-4361), session logout, and ingest key management. See spec 08a section 1. */
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { Router } from 'express'
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from 'viem/siwe'
import { getAddress } from 'viem'
import { z } from 'zod'
import type { ChainReader } from '../chain.js'
import type { Db } from '../db.js'
import { ingestKeys, revokedSessions, siweNonces } from '../schema.js'
import { newIngestKey, type Sessions } from '../session.js'
import { chainUnavailable, checksum, HttpError, iso, parse, zAddress } from '../util.js'

const NONCE_TTL_MS = 5 * 60 * 1000
const MAX_ACTIVE_KEYS = 10
const STATEMENT = 'Sign in to ChainPe. This does not move funds or cost gas.'

const invalidSiwe = (message: string) => new HttpError(401, 'invalid_siwe', message)

export interface AuthOptions {
  db: Db
  chain: ChainReader
  sessions: Sessions
  chainId: number
  dashboardDomain: string
  cliDomain: string
  now?: () => number
}

const nonceBody = z.object({ address: zAddress, client: z.enum(['dashboard', 'cli']).default('dashboard') }).strict()
const verifyBody = z
  .object({
    message: z.string().min(1).max(4096),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/, 'must be hex').max(20_000),
  })
  .strict()
const keyBody = z.object({ name: z.string().min(1).max(64).optional() }).strict()
const keyParams = z.object({ id: z.string().uuid() })

export function authRoutes(options: AuthOptions): Router {
  const { db, chain, sessions, chainId, dashboardDomain, cliDomain, now = Date.now } = options
  const router = Router()

  router.post('/auth/nonce', async (req, res) => {
    const { address, client } = parse(nonceBody, req.body)
    const domain = client === 'cli' ? cliDomain : dashboardDomain
    const uri = `https://${domain}`
    const nonce = generateSiweNonce()
    const issuedAt = new Date(now())
    const expiresAt = new Date(now() + NONCE_TTL_MS)
    await db.insert(siweNonces).values({ nonce, address, domain, uri, expiresAt })
    const message = createSiweMessage({
      address: getAddress(address),
      chainId,
      domain,
      uri,
      nonce,
      version: '1',
      statement: STATEMENT,
      issuedAt,
      expirationTime: expiresAt,
    })
    res.json({ nonce, message, expiresAt: expiresAt.toISOString() })
  })

  router.post('/auth/verify', async (req, res) => {
    const { message, signature } = parse(verifyBody, req.body)
    const fields = safeParseSiwe(message)
    if (!fields?.nonce) throw invalidSiwe('Not a SIWE message.')

    // Consumed before anything else, so it is single-use even under concurrent requests.
    const [row] = await db.delete(siweNonces).where(eq(siweNonces.nonce, fields.nonce)).returning()
    if (!row) throw invalidSiwe('Unknown or already used nonce.')

    const time = new Date(now())
    if (row.expiresAt <= time) throw invalidSiwe('Nonce expired.')
    if (fields.expirationTime && fields.expirationTime <= time) throw invalidSiwe('Message expired.')
    if (!fields.expirationTime) throw invalidSiwe('Message has no expiration time.')
    if (fields.chainId !== chainId) throw invalidSiwe('Wrong chain.')
    if (fields.domain !== row.domain) throw invalidSiwe('Wrong domain.')
    if (fields.uri !== row.uri) throw invalidSiwe('Wrong URI.')
    if (fields.address?.toLowerCase() !== row.address) throw invalidSiwe('Wrong address.')

    const address = getAddress(row.address)
    let valid: boolean
    try {
      valid = await chain.verifySiwe({
        message,
        signature: signature as `0x${string}`,
        domain: row.domain,
        nonce: row.nonce,
        address,
        time,
      })
    } catch {
      throw chainUnavailable()
    }
    if (!valid) throw invalidSiwe('Invalid signature.')

    let exists: boolean
    try {
      ;({ exists } = await chain.getProvider(address))
    } catch {
      throw chainUnavailable()
    }
    if (!exists) {
      throw new HttpError(403, 'not_registered', 'This wallet has no ChainPe provider account. Run `chainpe register` first.')
    }

    const { token, expiresAt } = await sessions.issue(address)
    res.json({ token, tokenType: 'Bearer', address, expiresAt: expiresAt.toISOString() })
  })

  router.post('/auth/logout', sessions.requireSession, async (req, res) => {
    const { jti, expiresAt } = req.session!
    await db.insert(revokedSessions).values({ jti, expiresAt }).onConflictDoNothing()
    res.json({ ok: true })
  })

  router.post('/keys', sessions.requireSession, async (req, res) => {
    const { name } = parse(keyBody, req.body ?? {})
    const provider = req.provider!
    const [{ active }] = await db
      .select({ active: count() })
      .from(ingestKeys)
      .where(and(eq(ingestKeys.provider, provider), isNull(ingestKeys.revokedAt)))
    if (active >= MAX_ACTIVE_KEYS) {
      throw new HttpError(409, 'too_many_keys', `A provider can hold ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`)
    }
    const { key, hash, prefix } = newIngestKey()
    const [row] = await db.insert(ingestKeys).values({ provider, keyHash: hash, prefix, name }).returning()
    res.status(201).json({ id: row.id, key, prefix, name: row.name, createdAt: row.createdAt.toISOString() })
  })

  router.get('/keys', sessions.requireSession, async (req, res) => {
    const rows = await db
      .select()
      .from(ingestKeys)
      .where(eq(ingestKeys.provider, req.provider!))
      .orderBy(desc(ingestKeys.createdAt))
    res.json({
      keys: rows.map((row) => ({
        id: row.id,
        prefix: row.prefix,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: iso(row.lastUsedAt),
        revokedAt: iso(row.revokedAt),
      })),
      owner: checksum(req.provider!),
    })
  })

  router.delete('/keys/:id', sessions.requireSession, async (req, res) => {
    const { id } = parse(keyParams, req.params)
    const [row] = await db
      .update(ingestKeys)
      .set({ revokedAt: new Date(now()) })
      .where(and(eq(ingestKeys.id, id), eq(ingestKeys.provider, req.provider!), isNull(ingestKeys.revokedAt)))
      .returning({ id: ingestKeys.id })
    if (!row) throw new HttpError(404, 'not_found', 'No active key with that id.')
    res.json({ ok: true, id: row.id })
  })

  return router
}

function safeParseSiwe(message: string) {
  try {
    return parseSiweMessage(message)
  } catch {
    return undefined
  }
}
