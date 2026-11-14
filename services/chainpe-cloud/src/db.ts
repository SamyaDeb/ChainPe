import { fileURLToPath } from 'node:url'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import * as schema from './schema.js'

export type Db = NodePgDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface DbHandle {
  pool: pg.Pool
  db: Db
}

export function createDb(connectionString: string): DbHandle {
  // Railway's internal Postgres has no TLS; a URL that asks for it gets it, with the certificate checked.
  const ssl = /sslmode=require/.test(connectionString) ? { rejectUnauthorized: true } : undefined
  const pool = new pg.Pool({ connectionString, ssl })
  return { pool, db: drizzle(pool, { schema }) }
}

/** Resolves from src/ in tests and dist/ in production: both sit one level below the service root. */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) })
}
