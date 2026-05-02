// Mirrored from platform/backend-api/src/services/pipeline.service.ts

export interface StagedPhaseRecord {
  phase_id: string;
  name?: string;
  status: string;
  artifact_path: string;
  sourced_from: string;
  completed_at?: string;
}

export interface StagedSprintRecord {
  sprint_id: string;
  phase_id?: string;
  name?: string;
  status: string;
  sprint_plan_path: string;
  sourced_from: string;
  completed_at?: string;
}

export interface StagedTaskRecord {
  sprint_id: string;
  phase_id?: string;
  task_id: string;
  label: string;
  status: "done" | "pending";
  sprint_plan_path: string;
  sourced_from: string;
  completed_at?: string;
}

export interface StagedPhasesResult {
  pipeline_id: string;
  refreshed_at: string;
  source: "artifacts";
  git_head_commit?: string;
  phases: StagedPhaseRecord[];
}

export interface StagedSprintsResult {
  pipeline_id: string;
  refreshed_at: string;
  source: "artifacts";
  git_head_commit?: string;
  sprints: StagedSprintRecord[];
}

export interface StagedTasksResult {
  pipeline_id: string;
  refreshed_at: string;
  source: "artifacts";
  git_head_commit?: string;
  tasks: StagedTaskRecord[];
}

// Project-scoped variants (not tied to a pipeline_id)
export interface RepoStagedPhasesResult {
  project_id: string;
  refreshed_at: string;
  source: "artifacts";
  git_head_commit?: string;
  phases: StagedPhaseRecord[];
}

export interface RepoStagedSprintsResult {
  project_id: string;
  refreshed_at: string;
  source: "artifacts";
  git_head_commit?: string;
  sprints: StagedSprintRecord[];
}

export interface RepoStagedTasksResult {
  project_id: string;
  refreshed_at: string;
  source: "artifacts";
  git_head_commit?: string;
  tasks: StagedTaskRecord[];
}
