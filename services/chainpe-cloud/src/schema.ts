/**
 * Postgres schema. Money is numeric(78,0): `pg` returns it as a string, and it
 * stays a string or a bigint in code. Addresses are stored lowercase.
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const atomic = (name: string) => numeric(name, { precision: 78, scale: 0 })
const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const providers = pgTable('providers', {
  address: text('address').primaryKey(),
  agentId: numeric('agent_id', { precision: 78, scale: 0 }),
  createdAt: time('created_at').notNull(),
  paidUntil: time('paid_until'),
  registeredBlock: bigint('registered_block', { mode: 'bigint' }).notNull(),
})

export const services = pgTable(
  'services',
  {
    key: text('key').primaryKey(),
    provider: text('provider').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    tags: text('tags').notNull().default(''),
    endpoint: text('endpoint').notNull(),
    price: text('price').notNull(),
    network: text('network').notNull(),
    payTo: text('pay_to').notNull(),
    acceptsExact: boolean('accepts_exact').notNull(),
    acceptsGateway: boolean('accepts_gateway').notNull(),
    active: boolean('active').notNull().default(true),
    createdBlock: bigint('created_block', { mode: 'bigint' }).notNull(),
    updatedBlock: bigint('updated_block', { mode: 'bigint' }).notNull(),
  },
  (t) => [index('services_provider').on(t.provider)]
)

export const subscriptions = pgTable(
  'subscriptions',
  {
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    provider: text('provider').notNull(),
    periods: integer('periods').notNull(),
    amountAtomic: atomic('amount_atomic').notNull(),
    paidUntil: time('paid_until').notNull(),
    block: bigint('block', { mode: 'bigint' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.txHash, t.logIndex] })]
)

export const siweNonces = pgTable('siwe_nonces', {
  nonce: text('nonce').primaryKey(),
  address: text('address').notNull(),
  domain: text('domain').notNull(),
  uri: text('uri').notNull(),
  expiresAt: time('expires_at').notNull(),
})

export const revokedSessions = pgTable('revoked_sessions', {
  jti: text('jti').primaryKey(),
  expiresAt: time('expires_at').notNull(),
})

export const ingestKeys = pgTable(
  'ingest_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    keyHash: text('key_hash').notNull(),
    prefix: text('prefix').notNull(),
    name: text('name'),
    createdAt: time('created_at').notNull().defaultNow(),
    lastUsedAt: time('last_used_at'),
    revokedAt: time('revoked_at'),
  },
  (t) => [uniqueIndex('ingest_keys_hash').on(t.keyHash), index('ingest_keys_provider').on(t.provider)]
)

export const paymentEvents = pgTable(
  'payment_events',
  {
    provider: text('provider').notNull(),
    id: text('id').notNull(),
    serviceKey: text('service_key'),
    ts: time('ts').notNull(),
    // Block time or Circle's createdAt once verified, the proxy's ts until then.
    effectiveTs: time('effective_ts').notNull(),
    route: text('route').notNull(),
    method: text('method').notNull(),
    rail: text('rail').$type<'exact' | 'gateway'>().notNull(),
    network: text('network').notNull(),
    amountAtomic: atomic('amount_atomic').notNull(),
    payer: text('payer').notNull(),
    payTo: text('pay_to').notNull(),
    txHash: text('tx_hash'),
    paymentId: text('payment_id'),
    status: text('status').$type<'completed' | 'failed' | 'pending'>().notNull(),
    latencyMs: integer('latency_ms').notNull(),
    backendStatus: integer('backend_status'),
    error: text('error'),
    verification: text('verification').$type<'unverified' | 'verified' | 'failed'>().notNull().default('unverified'),
    verificationReason: text('verification_reason'),
    // exact:<txHash>:<logIndex> or gateway:<transferId>. One claim per transfer.
    matchedTransfer: text('matched_transfer'),
    selfPay: boolean('self_pay').notNull().default(false),
    receiptCheckedAt: time('receipt_checked_at'),
    receivedAt: time('received_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.id] }),
    uniqueIndex('payment_events_claim').on(t.matchedTransfer),
    index('payment_events_list').on(t.provider, t.effectiveTs, t.id),
    index('payment_events_open')
      .on(t.receivedAt)
      .where(sql`${t.verification} <> 'verified'`),
    index('payment_events_payment_id').on(t.paymentId),
  ]
)

export const onchainTransfers = pgTable(
  'onchain_transfers',
  {
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    block: bigint('block', { mode: 'bigint' }).notNull(),
    blockTs: time('block_ts').notNull(),
    from: text('from').notNull(),
    to: text('to').notNull(),
    // 18 decimals, as the system emitter logs it.
    valueRaw: atomic('value_raw').notNull(),
    // 6 decimals. Null when value_raw is not a whole 6-decimal amount, so it can never match a price.
    amountAtomic: atomic('amount_atomic'),
  },
  (t) => [primaryKey({ columns: [t.txHash, t.logIndex] }), index('onchain_transfers_to').on(t.to, t.blockTs)]
)

export const gatewayTransfers = pgTable(
  'gateway_transfers',
  {
    id: text('id').primaryKey(),
    from: text('from').notNull(),
    to: text('to').notNull(),
    amountAtomic: atomic('amount_atomic').notNull(),
    token: text('token').notNull(),
    status: text('status').notNull(),
    nonce: text('nonce'),
    txHash: text('tx_hash'),
    network: text('network').notNull(),
    createdAt: time('created_at').notNull(),
    updatedAt: time('updated_at').notNull(),
    polledAt: time('polled_at').notNull().defaultNow(),
  },
  (t) => [index('gateway_transfers_to').on(t.to)]
)

export const feedback = pgTable(
  'feedback',
  {
    agentId: numeric('agent_id', { precision: 78, scale: 0 }).notNull(),
    client: text('client').notNull(),
    feedbackIndex: bigint('feedback_index', { mode: 'bigint' }).notNull(),
    // int128 on-chain.
    value: numeric('value', { precision: 78, scale: 0 }).notNull(),
    valueDecimals: integer('value_decimals').notNull(),
    tag1: text('tag1'),
    tag2: text('tag2'),
    endpoint: text('endpoint'),
    feedbackUri: text('feedback_uri'),
    revoked: boolean('revoked').notNull().default(false),
    block: bigint('block', { mode: 'bigint' }).notNull(),
    blockTs: time('block_ts').notNull(),
    txHash: text('tx_hash').notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.client, t.feedbackIndex] }), index('feedback_agent').on(t.agentId)]
)

export const heartbeats = pgTable(
  'heartbeats',
  {
    serviceKey: text('service_key').notNull(),
    ts: time('ts').notNull().defaultNow(),
    provider: text('provider').notNull(),
    version: text('version').notNull(),
    network: text('network').notNull(),
    rails: jsonb('rails').$type<string[]>().notNull(),
    gatewayBalanceAtomic: atomic('gateway_balance_atomic'),
    doctorJson: jsonb('doctor_json'),
  },
  (t) => [primaryKey({ columns: [t.serviceKey, t.ts] }), index('heartbeats_provider').on(t.provider, t.ts)]
)

export const myWallets = pgTable(
  'my_wallets',
  {
    provider: text('provider').notNull(),
    address: text('address').notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.address] })]
)

export const indexerState = pgTable('indexer_state', {
  id: integer('id').primaryKey(),
  lastBlock: bigint('last_block', { mode: 'bigint' }).notNull(),
})
