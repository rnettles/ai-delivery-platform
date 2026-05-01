// Mirrored from platform/backend-api/src/domain/pipeline.types.ts

export type PipelineRole =
  | "planner"
  | "sprint-controller"
  | "implementer"
  | "verifier";

export type PipelineMode = "next" | "next-flow" | "full-sprint";

export type PipelineStatus =
  | "running"
  | "awaiting_approval"
  | "awaiting_pr_review"
  | "paused_takeover"
  | "failed"
  | "complete"
  | "cancelled";

export type StepStatus =
  | "running"
  | "complete"
  | "failed"
  | "not_applicable";

export type GateOutcome =
  | "approved"
  | "human_complete"
  | "skipped"
  | "auto"
  | null;

export interface PipelineStepRecord {
  role: PipelineRole;
  execution_id?: string;
  status: StepStatus;
  gate_outcome: GateOutcome;
  artifact_paths: string[];
  actor: "system" | string;
  started_at: string;
  completed_at?: string;
  justification?: string;
  error_message?: string;
}

export interface PipelineSlackMetadata {
  slack_channel?: string;
  slack_user?: string;
  slack_thread_ts?: string;
  source: "slack" | "api";
}

export interface PipelineRun {
  pipeline_id: string;
  entry_point: PipelineRole;
  current_step: PipelineRole | "complete";
  status: PipelineStatus;
  steps: PipelineStepRecord[];
  metadata: PipelineSlackMetadata & Record<string, unknown>;
  project_id?: string;
  sprint_branch?: string;
  pr_number?: number;
  pr_url?: string;
  implementer_attempts: number;
  created_at: string;
  updated_at: string;
}
