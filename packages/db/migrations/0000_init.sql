CREATE TYPE "public"."lead_stage" AS ENUM('new', 'contacted', 'qualified', 'viewing_booked', 'viewed', 'reserved', 'lost');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"status" text DEFAULT 'bot' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"stage" "lead_stage" DEFAULT 'new' NOT NULL,
	"locale" text NOT NULL,
	"source" text NOT NULL,
	"name" text,
	"phone" text,
	"email" text,
	"consent" jsonb NOT NULL,
	"opted_out" boolean DEFAULT false NOT NULL,
	"interested_unit_ids" jsonb NOT NULL,
	"qualification" jsonb NOT NULL,
	"assigned_to_id" text,
	"conversation_id" text NOT NULL,
	"first_response_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" serial NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"channel" text NOT NULL,
	"text" text NOT NULL,
	"quick_replies" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salespeople" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"languages" jsonb NOT NULL,
	"unit_types" jsonb NOT NULL,
	"available" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"code" text NOT NULL,
	"building" text NOT NULL,
	"floor" integer NOT NULL,
	"type" text NOT NULL,
	"view" text NOT NULL,
	"area_sqft" real NOT NULL,
	"bedrooms" integer NOT NULL,
	"bathrooms" integer NOT NULL,
	"price_aed" integer NOT NULL,
	"availability" text NOT NULL,
	"payment_plan_ids" jsonb NOT NULL,
	"mesh_id" text,
	"floorplan_url" text
);
--> statement-breakpoint
CREATE TABLE "viewings" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"unit_id" text,
	"salesperson_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_id_salespeople_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."salespeople"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_salesperson_id_salespeople_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespeople"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_project_stage_idx" ON "leads" USING btree ("project_id","stage");--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "messages_conversation_seq_idx" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "units_project_idx" ON "units" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "viewings_lead_idx" ON "viewings" USING btree ("lead_id");