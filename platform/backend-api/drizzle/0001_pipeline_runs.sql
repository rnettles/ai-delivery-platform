CREATE TABLE IF NOT EXISTS "pipeline_runs" (
  "pipeline_id" uuid PRIMARY KEY NOT NULL,
  "entry_point" text NOT NULL,
  "current_step" text NOT NULL,
  "status" text NOT NULL,
  "steps" jsonb NOT NULL DEFAULT '[]',
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "input" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_pipeline_runs_status" ON "pipeline_runs" ("status");
