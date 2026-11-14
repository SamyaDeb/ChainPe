ALTER TABLE "feedback" ADD COLUMN "feedback_hash" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "verification_reason" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "paid_atomic" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "paid_to" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "payment_tx" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "verify_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "next_verify_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "agent_id" numeric(78, 0);--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_payment_tx_verified" ON "feedback" USING btree ("payment_tx") WHERE "feedback"."verified";--> statement-breakpoint
CREATE INDEX "feedback_pending" ON "feedback" USING btree ("next_verify_at") WHERE "feedback"."next_verify_at" IS NOT NULL;--> statement-breakpoint
-- Services indexed before this migration: link them to their provider's ERC-8004 agent (the indexer writes
-- services.agent_id from every later ServiceRegistered/ServiceUpdated event).
UPDATE "services" SET "agent_id" = "providers"."agent_id" FROM "providers" WHERE "services"."provider" = "providers"."address" AND "services"."agent_id" IS NULL AND "providers"."agent_id" IS NOT NULL;--> statement-breakpoint
-- Ratings indexed before this migration: queue them so verifyFeedback reads their feedbackHash back from the chain.
UPDATE "feedback" SET "next_verify_at" = now() WHERE "feedback_hash" IS NULL AND NOT "verified";
