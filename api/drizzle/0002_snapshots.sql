CREATE TABLE "snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"title" text,
	"tagline" text,
	"description" text,
	"price_text" text,
	"price_amount" numeric(12, 2),
	"price_currency" text,
	"price_period" text,
	"changed" boolean NOT NULL,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"missing_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"summary" text,
	"summary_status" text NOT NULL,
	"error" text,
	CONSTRAINT "snapshots_status_check" CHECK ("snapshots"."status" in ('ok', 'partial', 'not_found', 'fetch_failed')),
	CONSTRAINT "snapshots_summary_status_check" CHECK ("snapshots"."summary_status" in ('first_snapshot', 'not_changed', 'fetch_failed', 'not_found', 'incomplete_listing', 'pending'))
);
--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "next_poll_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "last_polled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "last_status" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "last_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "listing_state" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "snapshots_competitor_fetched_idx" ON "snapshots" USING btree ("competitor_id","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "snapshots_last_ok_idx" ON "snapshots" USING btree ("competitor_id","fetched_at" DESC NULLS LAST) WHERE "snapshots"."status" = 'ok';--> statement-breakpoint
CREATE INDEX "competitors_next_poll_at_idx" ON "competitors" USING btree ("next_poll_at");--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_listing_state_check" CHECK ("competitors"."listing_state" in ('unknown', 'listed', 'never_listed', 'delisted'));