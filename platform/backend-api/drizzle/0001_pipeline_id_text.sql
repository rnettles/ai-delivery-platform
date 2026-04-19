ALTER TABLE "pipeline_runs"
ALTER COLUMN "pipeline_id" TYPE text USING "pipeline_id"::text;
