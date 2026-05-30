CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"is_starred" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_place" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	"raw_entry_id" uuid,
	"confidence" real,
	"model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_normalized" text NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"place_type" text,
	"country_code" text,
	"country_name" text,
	"region_code" text,
	"region_name" text,
	"district_name" text,
	"place_name" text,
	"neighborhood_name" text,
	"provider" text DEFAULT 'nominatim' NOT NULL,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"body" text NOT NULL,
	"source" text DEFAULT 'text' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_place" ADD CONSTRAINT "person_place_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_place" ADD CONSTRAINT "person_place_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_place" ADD CONSTRAINT "person_place_raw_entry_id_raw_entries_id_fk" FOREIGN KEY ("raw_entry_id") REFERENCES "public"."raw_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "people_name_normalized_idx" ON "people" USING btree ("name_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "person_place_uniq" ON "person_place" USING btree ("person_id","place_id","relationship");--> statement-breakpoint
CREATE INDEX "person_place_place_idx" ON "person_place" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "places_query_normalized_idx" ON "places" USING btree ("query_normalized");