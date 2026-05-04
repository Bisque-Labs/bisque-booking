CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'cancelled', 'rescheduled');--> statement-breakpoint
CREATE TYPE "public"."poll_status" AS ENUM('open', 'closed', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'consultant');--> statement-breakpoint
CREATE TABLE "availability_polls" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "poll_status" DEFAULT 'open' NOT NULL,
	"share_token" text NOT NULL,
	"expires_at" timestamp with time zone,
	"confirmed_slot_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_polls_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type_id" integer NOT NULL,
	"client_email" text NOT NULL,
	"client_name" text NOT NULL,
	"client_timezone" text DEFAULT 'UTC' NOT NULL,
	"client_data" json DEFAULT '{}'::json NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"google_event_id" text,
	"cancel_token" text NOT NULL,
	"reschedule_token" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_cancel_token_unique" UNIQUE("cancel_token"),
	CONSTRAINT "bookings_reschedule_token_unique" UNIQUE("reschedule_token")
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"min_notice_hours" integer DEFAULT 1 NOT NULL,
	"max_horizon_days" integer DEFAULT 30 NOT NULL,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"location" text,
	"video_link" text,
	"intake_questions" json DEFAULT '[]'::json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_types_user_id_slug_unique" UNIQUE("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "poll_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"poll_id" integer NOT NULL,
	"participant_email" text NOT NULL,
	"participant_name" text NOT NULL,
	"responses" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"poll_id" integer NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"role" "user_role" DEFAULT 'consultant' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"hashed_password" text,
	"google_id" text,
	"google_credentials_encrypted" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_slug_unique" UNIQUE("slug"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
ALTER TABLE "availability_polls" ADD CONSTRAINT "availability_polls_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_responses" ADD CONSTRAINT "poll_responses_poll_id_availability_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."availability_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_slots" ADD CONSTRAINT "poll_slots_poll_id_availability_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."availability_polls"("id") ON DELETE cascade ON UPDATE no action;