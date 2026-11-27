DROP INDEX "snapshots_uneventful_fetched_idx";--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
UPDATE "snapshots" SET "last_checked_at" = "fetched_at";--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "last_checked_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "check_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "snapshots_uneventful_last_checked_idx" ON "snapshots" USING btree ("last_checked_at") WHERE not "snapshots"."changed" and "snapshots"."summary_status" <> 'first_snapshot';
