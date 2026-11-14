CREATE TABLE "fee_accounts" (
	"provider" text PRIMARY KEY NOT NULL,
	"enrolled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_accruals" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"revenue_atomic" numeric(78, 0) NOT NULL,
	"fee_bps" integer NOT NULL,
	"fee_atomic" numeric(78, 0) NOT NULL,
	"accrued_at" timestamp with time zone NOT NULL,
	"batch_id" text,
	CONSTRAINT "fee_accruals_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "fee_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"revenue_atomic" numeric(78, 0) NOT NULL,
	"fee_atomic" numeric(78, 0) NOT NULL,
	"status" text NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fee_accruals_open" ON "fee_accruals" USING btree ("provider","batch_id");--> statement-breakpoint
CREATE INDEX "fee_batches_provider" ON "fee_batches" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "fee_batches_status" ON "fee_batches" USING btree ("status");