CREATE TABLE "device_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"public_key" text NOT NULL,
	"device_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	CONSTRAINT "device_keys_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
ALTER TABLE "acp_sessions" ADD COLUMN "wrapped_dek" text;--> statement-breakpoint
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_keys_user_id_idx" ON "device_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "device_keys_public_key_idx" ON "device_keys" USING btree ("public_key");--> statement-breakpoint
DROP TABLE "apikey";
