CREATE TABLE "llm_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "snapshots" DROP CONSTRAINT "snapshots_summary_status_check";--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "changes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "summary_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "summary_next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "summary_error" text;--> statement-breakpoint
CREATE INDEX "snapshots_summary_due_idx" ON "snapshots" USING btree ("summary_next_attempt_at") WHERE "snapshots"."summary_next_attempt_at" is not null;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_summary_status_check" CHECK ("snapshots"."summary_status" in ('first_snapshot', 'not_changed', 'fetch_failed', 'not_found', 'incomplete_listing', 'pending', 'summarized', 'llm_timeout', 'llm_failed', 'unusable_output', 'daily_cap_reached'));--> statement-breakpoint
UPDATE "snapshots" SET "summary_next_attempt_at" = now() WHERE "summary_status" = 'pending';
