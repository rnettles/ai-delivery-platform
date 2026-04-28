// Mirrored from platform/backend-api/src/domain/pipeline.types.ts
// and platform/backend-api/src/services/pipeline.service.ts
// Keep in sync when backend types change.

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

export type StepStatus = "running" | "complete" | "failed" | "not_applicable";

export type GateOutcome = "approved" | "human_complete" | "skipped" | "auto" | null;

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
  project_id?: string;
  sprint_branch?: string;
  pr_number?: number;
  pr_url?: string;
  implementer_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface PipelineExecutionSignal {
  level: "waiting" | "warning" | "error";
  code: string;
  message: string;
  since?: string;
  minutes?: number;
}

export type AdminOpsAction = "diagnose" | "reconcile" | "reset-workspace" | "retry";
export type AdminOpsStatus = "queued" | "running" | "succeeded" | "failed" | "blocked";

export interface AdminOpsGitSummary {
  repo_path: string;
  is_repo_accessible: boolean;
  current_branch?: string;
  detached_head?: boolean;
  upstream_tracking?: string;
  remote_ref_present?: boolean;
  remote_refspec_broad?: boolean;
  remote_refspecs?: string[];
  shallow?: boolean;
  merge_base_valid?: boolean;
  rebase_in_progress?: boolean;
}

export interface PipelineLatestOperationSummary {
  operation_id: string;
  action: AdminOpsAction;
  status: AdminOpsStatus;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  escalation_reason?: string;
  escalation_summary?: string;
  human_action_checklist?: string[];
  attempted_steps?: Array<{
    name: string;
    status: string;
    started_at: string;
    completed_at?: string;
  }>;
  before_git?: AdminOpsGitSummary;
  after_git?: AdminOpsGitSummary;
}

export interface CreateAdminOpsJobRequest {
  action: AdminOpsAction;
  actor?: string;
  project_id?: string;
  pipeline_id?: string;
  options?: {
    branch?: string;
    base_branch?: string;
    head_branch?: string;
  };
}

export interface AdminOpsJob {
  job_id: string;
  action: AdminOpsAction;
  status: AdminOpsStatus;
  actor: string;
  project_id?: string;
  pipeline_id?: string;
  queued_at: string;
  started_at?: string;
  completed_at?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  outcome?: {
    escalation_reason?: string;
    escalation_summary?: string;
    human_action_checklist?: string[];
    attempted_steps: Array<{
      name: string;
      status: string;
      started_at: string;
      completed_at?: string;
    }>;
    before_git?: AdminOpsGitSummary;
    after_git?: AdminOpsGitSummary;
  };
  updated_at: string;
}

export interface AdminOpsCreateResponse {
  ok: boolean;
  operation: AdminOpsJob;
  status_url: string;
}

export interface AdminOpsStatusResponse {
  ok: boolean;
  operation: AdminOpsJob;
}

export interface PipelineStatusSummary extends PipelineRun {
  repo_url?: string;
  control_state?: {
    refreshed_at: string;
    source: "artifacts";
    git_head_commit?: string;
    current_task?: Record<string, unknown>;
    verification?: Record<string, unknown>;
    closeout?: Record<string, unknown>;
  };
  last_error?: { code: string; message: string; details?: unknown };
  prior_step_detail?: PipelineStepRecord;
  current_step_detail?: PipelineStepRecord;
  execution_signals?: PipelineExecutionSignal[];
  latest_operation?: PipelineLatestOperationSummary;
}

export interface PipelineStatusChoice {
  pipeline_id: string;
  status: PipelineStatus;
  current_step: PipelineRole | "complete";
  current_actor?: string;
  project_id?: string;
  repo_url?: string;
  sprint_branch?: string;
  updated_at: string;
  wait_state?: string;
}

export type CurrentPipelineStatusResult =
  | { kind: "none"; message: string }
  | { kind: "single"; run: PipelineStatusSummary }
  | { kind: "multiple"; runs: PipelineStatusChoice[] };

export interface ChannelPipelineStatusListResult {
  channel_id: string;
  runs: PipelineStatusChoice[];
}

export interface StagedPhaseRecord {
  phase_id: string;
  name?: string;
  status?: string;
  artifact_path?: string;
}

export interface StagedSprintRecord {
  sprint_id: string;
  phase_id?: string;
  name?: string;
  status?: string;
  artifact_path?: string;
}

export interface StagedTaskRecord {
  task_id: string;
  sprint_id?: string;
  label?: string;
  status?: string;
}

export interface StagedPhasesResult {
  phases: StagedPhaseRecord[];
  total: number;
}

export interface StagedSprintsResult {
  sprints: StagedSprintRecord[];
  total: number;
}

export interface StagedTasksResult {
  tasks: StagedTaskRecord[];
  total: number;
}

export interface CreatePipelineRequest {
  entry_point: PipelineRole;
  execution_mode?: PipelineMode;
  input?: Record<string, unknown>;
  metadata?: Partial<PipelineSlackMetadata> & Record<string, unknown>;
}

export interface HealthResponse {
  status: "ok" | string;
  timestamp: string;
  version?: string;
  uptime_seconds?: number;
}

export interface GitSyncResponse {
  ok: boolean;
  repos?: Array<{
    project_id: string;
    repo_url: string;
    head_commit?: string;
    is_accessible: boolean;
    synced_at: string;
  }>;
}

export interface GitStatusResponse {
  repos: Array<{
    project_id: string;
    repo_url: string;
    head_commit?: string;
    is_accessible: boolean;
    clone_path: string;
  }>;
}
