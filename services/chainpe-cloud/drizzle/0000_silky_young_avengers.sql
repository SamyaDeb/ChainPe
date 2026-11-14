CREATE TABLE IF NOT EXISTS "feedback" (
	"agent_id" numeric(78, 0) NOT NULL,
	"client" text NOT NULL,
	"feedback_index" bigint NOT NULL,
	"value" numeric(78, 0) NOT NULL,
	"value_decimals" integer NOT NULL,
	"tag1" text,
	"tag2" text,
	"endpoint" text,
	"feedback_uri" text,
	"revoked" boolean DEFAULT false NOT NULL,
	"block" bigint NOT NULL,
	"block_ts" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL,
	CONSTRAINT "feedback_agent_id_client_feedback_index_pk" PRIMARY KEY("agent_id","client","feedback_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gateway_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"amount_atomic" numeric(78, 0) NOT NULL,
	"token" text NOT NULL,
	"status" text NOT NULL,
	"nonce" text,
	"tx_hash" text,
	"network" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"polled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "heartbeats" (
	"service_key" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"version" text NOT NULL,
	"network" text NOT NULL,
	"rails" jsonb NOT NULL,
	"gateway_balance_atomic" numeric(78, 0),
	"doctor_json" jsonb,
	CONSTRAINT "heartbeats_service_key_ts_pk" PRIMARY KEY("service_key","ts")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "indexer_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingest_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "my_wallets" (
	"provider" text NOT NULL,
	"address" text NOT NULL,
	CONSTRAINT "my_wallets_provider_address_pk" PRIMARY KEY("provider","address")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onchain_transfers" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block" bigint NOT NULL,
	"block_ts" timestamp with time zone NOT NULL,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"value_raw" numeric(78, 0) NOT NULL,
	"amount_atomic" numeric(78, 0),
	CONSTRAINT "onchain_transfers_tx_hash_log_index_pk" PRIMARY KEY("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_events" (
	"provider" text NOT NULL,
	"id" text NOT NULL,
	"service_key" text,
	"ts" timestamp with time zone NOT NULL,
	"effective_ts" timestamp with time zone NOT NULL,
	"route" text NOT NULL,
	"method" text NOT NULL,
	"rail" text NOT NULL,
	"network" text NOT NULL,
	"amount_atomic" numeric(78, 0) NOT NULL,
	"payer" text NOT NULL,
	"pay_to" text NOT NULL,
	"tx_hash" text,
	"payment_id" text,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"backend_status" integer,
	"error" text,
	"verification" text DEFAULT 'unverified' NOT NULL,
	"verification_reason" text,
	"matched_transfer" text,
	"self_pay" boolean DEFAULT false NOT NULL,
	"receipt_checked_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_provider_id_pk" PRIMARY KEY("provider","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "providers" (
	"address" text PRIMARY KEY NOT NULL,
	"agent_id" numeric(78, 0),
	"created_at" timestamp with time zone NOT NULL,
	"paid_until" timestamp with time zone,
	"registered_block" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "revoked_sessions" (
	"jti" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "services" (
	"key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" text DEFAULT '' NOT NULL,
	"endpoint" text NOT NULL,
	"price" text NOT NULL,
	"network" text NOT NULL,
	"pay_to" text NOT NULL,
	"accepts_exact" boolean NOT NULL,
	"accepts_gateway" boolean NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_block" bigint NOT NULL,
	"updated_block" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "siwe_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"domain" text NOT NULL,
	"uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"provider" text NOT NULL,
	"periods" integer NOT NULL,
	"amount_atomic" numeric(78, 0) NOT NULL,
	"paid_until" timestamp with time zone NOT NULL,
	"block" bigint NOT NULL,
	CONSTRAINT "subscriptions_tx_hash_log_index_pk" PRIMARY KEY("tx_hash","log_index")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_agent" ON "feedback" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_transfers_to" ON "gateway_transfers" USING btree ("to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeats_provider" ON "heartbeats" USING btree ("provider","ts");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ingest_keys_hash" ON "ingest_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_keys_provider" ON "ingest_keys" USING btree ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onchain_transfers_to" ON "onchain_transfers" USING btree ("to","block_ts");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_events_claim" ON "payment_events" USING btree ("matched_transfer");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_events_list" ON "payment_events" USING btree ("provider","effective_ts","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_events_open" ON "payment_events" USING btree ("received_at") WHERE "payment_events"."verification" <> 'verified';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_events_payment_id" ON "payment_events" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "services_provider" ON "services" USING btree ("provider");