export type PipelineRole =
  | "planner"
  | "sprint-controller"
  | "implementer"
  | "verifier";

/**
 * Controls how far downstream a pipeline run propagates after the entry role completes.
 *
 * - "next"        — run only the entry role, then stop. Human gates active (planner → awaiting_approval).
 * - "next-flow"   — chain into role-specific downstream. Human gates active (planner → awaiting_approval,
 *                   then operator approves before sprint-controller proceeds).
 * - "full-sprint" — fully autonomous end-to-end. All human gates bypassed; pipeline runs to
 *                   awaiting_pr_review without operator intervention.
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
  | "awaiting_pr_review"
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
  input?: Record<string, unknown>;
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
  /** Sprint branch to checkout before running the entry role. Required when entry_point is verifier. */
  sprint_branch?: string;
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

export type PipelineNotificationEvent = "step_start" | "progress" | "step_complete" | "gate";

export interface PipelineNotification {
  pipeline_id: string;
  step: PipelineRole | "complete";
  status: PipelineStatus;
  gate_required: boolean;
  artifact_paths: string[];
  metadata: PipelineRun["metadata"];
  /** Canonical agent label used by downstream notifiers (for example: Planner, Sprint-Controller). */
  agent_caller?: string;
  /** Notification event kind — defaults to gate/complete rendering when absent */
  event?: PipelineNotificationEvent;
  /** Human-readable progress message for event === 'progress' */
  message?: string;
}
