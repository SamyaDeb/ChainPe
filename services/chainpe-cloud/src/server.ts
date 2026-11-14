/** Entry point: migrations, then the API and, unless WORKERS_ENABLED=false, the workers. */
import 'dotenv/config'
import { lt } from 'drizzle-orm'
import { createApp } from './app.js'
import { createChainReader, createClient } from './chain.js'
import { loadEnv } from './config.js'
import { createDb, runMigrations } from './db.js'
import { createProviderViews } from './plan.js'
import { revokedSessions, siweNonces } from './schema.js'
import { createSessions } from './session.js'
import { createIndexer, viemRpc } from './workers/indexer.js'
import { createReconciler } from './workers/reconciler.js'
import { createFeedbackVerifier } from './workers/verifyFeedback.js'
import { startLoop, type Loop } from './workers/runner.js'

async function main(): Promise<void> {
  const env = loadEnv()
  const { db, pool } = createDb(env.DATABASE_URL)
  await runMigrations(db)

  const client = createClient(env)
  const chain = createChainReader(client, env)
  const views = createProviderViews(db, chain)
  const sessions = createSessions(db, env.SESSION_SECRET)
  const rpc = viemRpc(client, env.CHAINPE_REGISTRY_ADDRESS, env.GETLOGS_GAP_MS)
  const caip2 = `eip155:${env.CHAIN_ID}`
  const indexer = createIndexer({
    db,
    rpc,
    registry: env.CHAINPE_REGISTRY_ADDRESS,
    reputation: env.ERC8004_REPUTATION_REGISTRY,
    usdc: env.USDC_ADDRESS,
    caip2,
    startBlock: env.REGISTRY_DEPLOY_BLOCK,
    maxChunk: env.GETLOGS_MAX_BLOCKS,
    onProviderChanged: (provider) => views.invalidate(provider),
  })
  const reconciler = createReconciler({ db, rpc, usdc: env.USDC_ADDRESS })
  const verifier = createFeedbackVerifier({ db, rpc, usdc: env.USDC_ADDRESS })

  let reconcileLoop: Loop | undefined
  const app = createApp({
    db,
    chain,
    sessions,
    views,
    corsOrigins: env.CORS_ORIGIN,
    publicCorsOrigins: env.PUBLIC_CORS_ORIGIN,
    sampleProviders: env.SAMPLE_PROVIDERS,
    chainId: env.CHAIN_ID,
    dashboardDomain: env.SIWE_DOMAIN,
    cliDomain: env.SIWE_CLI_DOMAIN,
    onEvents: () => reconcileLoop?.wake(),
    indexerStatus: async () => ({ cursor: (await indexer.cursor()).toString(), head: indexer.head().toString() }),
    dashboardDir: env.DASHBOARD_DIR,
  })
  const server = app.listen(env.PORT, () => console.log(`chainpe-cloud (Avalanche ${env.CHAIN_ID}) on :${env.PORT}, workers ${env.WORKERS_ENABLED ? 'on' : 'off'}`))

  const loops: Loop[] = []
  if (env.WORKERS_ENABLED) {
    reconcileLoop = startLoop('reconciler', 3_000, () => reconciler.run())
    loops.push(
      reconcileLoop,
      startLoop('indexer', 3_000, () => indexer.step(), 1_000),
      // Checks the payment behind each new rating; ratings whose tx is not visible yet retry with backoff.
      startLoop('verify-feedback', 10_000, () => verifier.run(), 1_000),
      startLoop('cleanup', 600_000, async () => {
        await db.delete(siweNonces).where(lt(siweNonces.expiresAt, new Date()))
        await db.delete(revokedSessions).where(lt(revokedSessions.expiresAt, new Date()))
      })
    )
  }

  const shutdown = (): void => {
    loops.forEach((loop) => loop.stop())
    server.close(() => void pool.end().finally(() => process.exit(0)))
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error((err as Error).message)
  process.exit(1)
})
