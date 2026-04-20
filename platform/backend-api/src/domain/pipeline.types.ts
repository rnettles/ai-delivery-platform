export type PipelineRole =
  | "planner"
  | "sprint-controller"
  | "implementer"
  | "verifier";

/**
 * Controls how far downstream a pipeline run propagates after the entry role completes.
 *
 * - "next"        — run only the entry role, then stop.
 * - "next-flow"   — chain into role-specific downstream (varies by entry_point).
 * - "full-sprint" — sprint-controller iterates all pending sprint tasks end-to-end.
 */
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
  // project linkage (ADR-027)
  project_id?: string;
  // sprint execution fields (ADR-030)
  sprint_branch?: string;
  pr_number?: number;
  pr_url?: string;
  implementer_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface CreatePipelineRequest {
  entry_point: PipelineRole;
  /** Controls downstream chaining after the entry role finishes. Defaults to full-pipeline when omitted. */
  execution_mode?: PipelineMode;
  input?: Record<string, unknown>;
  metadata?: Partial<PipelineSlackMetadata> & Record<string, unknown>;
}

export interface PipelineApproveRequest {
  actor: string;
}

export interface PipelineTakeoverRequest {
  actor: string;
}

export interface PipelineHandoffRequest {
  actor: string;
  artifact_path?: string;
}

export interface PipelineSkipRequest {
  actor: string;
  justification: string;
}

export interface PipelineNotification {
  pipeline_id: string;
  step: PipelineRole | "complete";
  status: PipelineStatus;
  gate_required: boolean;
  artifact_paths: string[];
  metadata: PipelineRun["metadata"];
}
