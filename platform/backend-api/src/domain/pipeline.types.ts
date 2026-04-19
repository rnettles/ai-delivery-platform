export type PipelineRole =
  | "planner"
  | "sprint-controller"
  | "implementer"
  | "verifier"
  | "fixer";

export type PipelineStatus =
  | "running"
  | "awaiting_approval"
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
  created_at: string;
  updated_at: string;
}

export interface CreatePipelineRequest {
  entry_point: PipelineRole;
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
