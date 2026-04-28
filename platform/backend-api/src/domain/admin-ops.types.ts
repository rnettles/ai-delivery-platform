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

export interface AdminOpsStep {
  name: string;
  status: "running" | "succeeded" | "failed" | "blocked";
  started_at: string;
  completed_at?: string;
  details?: Record<string, unknown>;
}

export interface GithubRequestMetadata {
  endpoint: string;
  owner?: string;
  repo?: string;
  base?: string;
  head?: string;
  status_code?: number;
  sanitized_body?: Record<string, unknown>;
}

export interface AdminOpsOutcome {
  escalation_reason?: string;
  escalation_summary?: string;
  human_action_checklist?: string[];
  attempted_steps: AdminOpsStep[];
  before_git?: AdminOpsGitSummary;
  after_git?: AdminOpsGitSummary;
  github_requests?: GithubRequestMetadata[];
  correlation?: {
    pipeline_id?: string;
    operation_id: string;
  };
  details?: Record<string, unknown>;
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
  outcome?: AdminOpsOutcome;
  options?: CreateAdminOpsJobRequest["options"];
  telemetry: {
    attempted_steps: AdminOpsStep[];
  };
  updated_at: string;
  version: number;
}
