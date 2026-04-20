CREATE TABLE "project_channels" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"repo_url" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"clone_path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "pipeline_runs" ALTER COLUMN "pipeline_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "sprint_branch" text;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "pr_number" integer;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "pr_url" text;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "implementer_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_channels" ADD CONSTRAINT "project_channels_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_channels_project" ON "project_channels" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_projects_name" ON "projects" USING btree ("name");--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pipeline_runs_project" ON "pipeline_runs" USING btree ("project_id");