CREATE TABLE IF NOT EXISTS "execution_records" (
  "execution_id" uuid PRIMARY KEY NOT NULL,
  "ok" boolean NOT NULL,
  "request_id" text,
  "correlation_id" text,
  "target_type" text NOT NULL,
  "target_name" text NOT NULL,
  "target_version" text NOT NULL,
  "artifacts" jsonb NOT NULL DEFAULT '[]',
  "output" jsonb,
  "errors" jsonb NOT NULL DEFAULT '[]',
  "status" text NOT NULL,
  "started_at" timestamp NOT NULL,
  "completed_at" timestamp NOT NULL,
  "duration_ms" integer NOT NULL,
  "input" jsonb NOT NULL DEFAULT '{}',
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "replay_of_execution_id" text,
  "git_sync" jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "idx_execution_records_correlation" ON "execution_records" ("correlation_id");
CREATE INDEX IF NOT EXISTS "idx_execution_records_target_name" ON "execution_records" ("target_name");
CREATE INDEX IF NOT EXISTS "idx_execution_records_status" ON "execution_records" ("status");
CREATE INDEX IF NOT EXISTS "idx_execution_records_started_at" ON "execution_records" ("started_at");
