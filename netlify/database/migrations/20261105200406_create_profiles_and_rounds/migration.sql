CREATE TABLE "profiles" (
	"id" text PRIMARY KEY,
	"email" text DEFAULT '' NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"username" text,
	"hometown" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"bank" numeric DEFAULT '1000' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" bigserial PRIMARY KEY,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"strategy" text DEFAULT 'Just playing' NOT NULL,
	"bet_total" numeric NOT NULL,
	"net" numeric NOT NULL,
	"bank_after" numeric NOT NULL,
	"dealer_up" text NOT NULL,
	"dealer_cards" jsonb DEFAULT '[]' NOT NULL,
	"true_count" numeric DEFAULT '0' NOT NULL,
	"start_hand" text DEFAULT '' NOT NULL,
	"hands" jsonb DEFAULT '[]' NOT NULL,
	"mistakes" jsonb DEFAULT '[]' NOT NULL,
	"decisions" integer DEFAULT 0 NOT NULL,
	"blackjack" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_username_lower_key" ON "profiles" (lower("username"));--> statement-breakpoint
CREATE INDEX "rounds_user_created" ON "rounds" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_user_id_profiles_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE;