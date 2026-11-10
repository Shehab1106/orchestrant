CREATE TABLE IF NOT EXISTS "idempotency_record" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"final_status" text NOT NULL,
	"final_result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_attempt" (
	"id" serial PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_id" text NOT NULL,
	"status" text NOT NULL,
	"error_category" text NOT NULL,
	"error_code" text,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"psp_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routing_rule" (
	"id" serial PRIMARY KEY NOT NULL,
	"priority" integer NOT NULL,
	"conditions" jsonb NOT NULL,
	"weights" jsonb NOT NULL,
	"fallback_order" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
