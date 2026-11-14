/**
 * ChainPe indexer entrypoint: starts the REST API and the watcher loop.
 *
 * The watcher polls `getLogs` for ChainPeRegistry + ERC-8004 Reputation events
 * into Postgres; the API serves O(1) discovery + reputation reads. Point clients
 * at it instead of scanning the registry on-chain.
 */
import 'dotenv/config'
import { createPublicClient, http, type PublicClient } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import {
  NETWORK,
  RPC_URL,
  REGISTRY_ADDRESS,
  REPUTATION_ADDRESS,
  DATABASE_URL,
  PORT,
  START_BLOCK,
  POLL_INTERVAL_MS,
  LOG_CHUNK
} from './config.js'
import { createDb, ensureSchema } from './db.js'
import { runIndexer } from './indexer.js'
import { createApi } from './api.js'

async function main() {
  const { pool, db } = createDb(DATABASE_URL)
  await ensureSchema(pool)

  const client = createPublicClient({
    chain: NETWORK === 'avalanche' ? avalanche : avalancheFuji,
    transport: http(RPC_URL)
  }) as PublicClient

  createApi(db).listen(PORT, () => {
    console.log(`ChainPe indexer API on :${PORT}`)
    console.log(`  network:    ${NETWORK}`)
    console.log(`  registry:   ${REGISTRY_ADDRESS}`)
    console.log(`  reputation: ${REPUTATION_ADDRESS}`)
    console.log(`  endpoints:  GET /health · /stats · /services · /services/:id · /services/:id/reputation`)
  })

  // Run the watcher loop forever (alongside the API).
  runIndexer({
    db,
    client,
    registry: REGISTRY_ADDRESS,
    reputation: REPUTATION_ADDRESS,
    startBlock: START_BLOCK,
    chunk: LOG_CHUNK,
    pollIntervalMs: POLL_INTERVAL_MS
  }).catch(err => {
    console.error('indexer loop crashed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}

if (process.env.NODE_ENV !== 'test') {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
