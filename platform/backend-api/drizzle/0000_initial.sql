CREATE TABLE IF NOT EXISTS "state" (
  "state_id" uuid PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "scope" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "data" jsonb NOT NULL,
  "metadata" jsonb,
  "status" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_state_scope" ON "state" ("scope");

CREATE TABLE IF NOT EXISTS "state_history" (
  "id" uuid PRIMARY KEY NOT NULL,
  "state_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "data" jsonb NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_state_history_state" ON "state_history" ("state_id");
