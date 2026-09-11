CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('unknown_customer', 'ambiguous_order', 'allergy_request', 'unavailable_item', 'repeated_failures', 'human_handoff', 'caller_mismatch', 'system_error');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('in_progress', 'completed', 'handoff', 'abandoned', 'failed');--> statement-breakpoint
CREATE TYPE "public"."confirmation_state" AS ENUM('pending', 'confirmed', 'rejected', 'none');--> statement-breakpoint
CREATE TYPE "public"."menu_category" AS ENUM('main', 'vegetarian', 'soup', 'dessert', 'special');--> statement-breakpoint
CREATE TYPE "public"."modification_type" AS ENUM('without', 'replace', 'extra', 'note');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('voice', 'manual');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('NEW', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'STAFF', 'KITCHEN');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "alert_type" NOT NULL,
	"severity" "alert_severity" DEFAULT 'warning' NOT NULL,
	"message" text NOT NULL,
	"call_id" uuid,
	"order_id" uuid,
	"customer_id" uuid,
	"customer_code" text DEFAULT '' NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" text DEFAULT '' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_email" text DEFAULT '' NOT NULL,
	"actor_role" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"call_id" uuid,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_sid" text NOT NULL,
	"provider" text DEFAULT 'twilio' NOT NULL,
	"caller_number" text DEFAULT '' NOT NULL,
	"customer_id" uuid,
	"customer_code" text DEFAULT '' NOT NULL,
	"stage" text DEFAULT 'ASK_CODE' NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detected_order" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmation" "confirmation_state" DEFAULT 'none' NOT NULL,
	"order_id" uuid,
	"call_status" "call_status" DEFAULT 'in_progress' NOT NULL,
	"handoff_reason" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_code" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text NOT NULL,
	"salutation" text DEFAULT '' NOT NULL,
	"phone_number" text DEFAULT '' NOT NULL,
	"room_number" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"order_deadline" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_day_id" uuid NOT NULL,
	"date" date NOT NULL,
	"position" integer NOT NULL,
	"name_de" text NOT NULL,
	"description_de" text DEFAULT '' NOT NULL,
	"category" "menu_category" DEFAULT 'main' NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"components" text[] DEFAULT '{}'::text[] NOT NULL,
	"allergens" text[] DEFAULT '{}'::text[] NOT NULL,
	"ingredients" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_modifications" text[] DEFAULT '{}'::text[] NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_modifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" "modification_type" NOT NULL,
	"target" text NOT NULL,
	"replacement" text DEFAULT '' NOT NULL,
	"text_de" text NOT NULL,
	"allowed" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "order_status" NOT NULL,
	"changed_by" text DEFAULT '' NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_date" date NOT NULL,
	"customer_id" uuid,
	"customer_code" text NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"room_number" text DEFAULT '' NOT NULL,
	"menu_item_id" uuid,
	"item_position" integer,
	"item_name" text NOT NULL,
	"components" text[] DEFAULT '{}'::text[] NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"special_request" text DEFAULT '' NOT NULL,
	"allergy_note" text DEFAULT '' NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reason" text DEFAULT '' NOT NULL,
	"status" "order_status" DEFAULT 'NEW' NOT NULL,
	"source" "order_source" DEFAULT 'voice' NOT NULL,
	"call_id" uuid,
	"confirmed_by_customer" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"restaurant_name" text DEFAULT 'Mittagessen-Service' NOT NULL,
	"store_transcripts" boolean DEFAULT true NOT NULL,
	"call_retention_days" integer DEFAULT 30 NOT NULL,
	"order_retention_days" integer DEFAULT 365 NOT NULL,
	"handoff_number" text DEFAULT '' NOT NULL,
	"order_deadline" text DEFAULT '10:30' NOT NULL,
	"allow_same_day_after_deadline" boolean DEFAULT true NOT NULL,
	"max_failures" integer DEFAULT 3 NOT NULL,
	"confidence_threshold_percent" integer DEFAULT 70 NOT NULL,
	"use_caller_id" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"role" "user_role" DEFAULT 'STAFF' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_menu_day_id_menu_days_id_fk" FOREIGN KEY ("menu_day_id") REFERENCES "public"."menu_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_modifications" ADD CONSTRAINT "order_modifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_resolved_idx" ON "alerts" USING btree ("resolved","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_sid_idx" ON "calls" USING btree ("call_sid");--> statement-breakpoint
CREATE INDEX "calls_customer_idx" ON "calls" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "calls_started_idx" ON "calls" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_code_idx" ON "customers" USING btree ("customer_code");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone_number");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_days_date_idx" ON "menu_days" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_items_date_position_idx" ON "menu_items" USING btree ("date","position");--> statement-breakpoint
CREATE INDEX "menu_items_date_idx" ON "menu_items" USING btree ("date");--> statement-breakpoint
CREATE INDEX "order_modifications_order_idx" ON "order_modifications" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_date_idx" ON "orders" USING btree ("order_date");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_code_idx" ON "orders" USING btree ("customer_code");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree (lower("email"));