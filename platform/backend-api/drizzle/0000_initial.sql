CREATE TABLE "state" (
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
--> statement-breakpoint
CREATE TABLE "state_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"state_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"pipeline_id" uuid PRIMARY KEY NOT NULL,
	"entry_point" text NOT NULL,
	"current_step" text NOT NULL,
	"status" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_records" (
	"execution_id" uuid PRIMARY KEY NOT NULL,
	"ok" boolean NOT NULL,
	"request_id" text,
	"correlation_id" text,
	"target_type" text NOT NULL,
	"target_name" text NOT NULL,
	"target_version" text NOT NULL,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output" jsonb,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp NOT NULL,
	"duration_ms" integer NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"replay_of_execution_id" text,
	"git_sync" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_state_scope" ON "state" USING btree ("scope");
--> statement-breakpoint
CREATE INDEX "idx_state_history_state" ON "state_history" USING btree ("state_id");
--> statement-breakpoint
CREATE INDEX "idx_pipeline_runs_status" ON "pipeline_runs" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_pipeline_runs_channel" ON "pipeline_runs" USING btree ("metadata");
--> statement-breakpoint
CREATE INDEX "idx_execution_records_correlation" ON "execution_records" USING btree ("correlation_id");
--> statement-breakpoint
CREATE INDEX "idx_execution_records_target_name" ON "execution_records" USING btree ("target_name");
--> statement-breakpoint
CREATE INDEX "idx_execution_records_status" ON "execution_records" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_execution_records_started_at" ON "execution_records" USING btree ("started_at");
