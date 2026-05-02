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
  status: "staged";
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
