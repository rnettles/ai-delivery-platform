import { useQuery, useQueries } from "@tanstack/react-query";
import type {
  RepoStagedPhasesResult,
  RepoStagedSprintsResult,
  RepoStagedTasksResult,
  StagedSprintsResult,
  StagedTasksResult,
  StagedPhaseRecord,
  StagedSprintRecord,
  StagedTaskRecord,
} from "@/types";

export type WorkStatus = "done" | "current" | "pending" | "approval" | "pr_review";

export interface WorkTask extends StagedTaskRecord {
  workStatus: WorkStatus;
}

export interface WorkSprint extends StagedSprintRecord {
  workStatus: WorkStatus;
  tasks: WorkTask[];
}

export interface WorkPhase extends StagedPhaseRecord {
  workStatus: WorkStatus;
  sprints: WorkSprint[];
}

function derivePhaseStatus(status: string): WorkStatus {
  const s = status.toLowerCase();
  if (s.includes("complete") || s.includes("closed") || s.includes("done")) return "done";
  if (s === "awaiting_pr_review") return "pr_review";
  if (s === "awaiting_approval" || s === "ready_for_verification") return "approval";
  if (s === "active" || s === "planning" || s === "approved" || s === "draft") return "current";
  return "pending";
}

function deriveSprintStatus(status: string): WorkStatus {
  const s = status.toLowerCase();
  if (s.includes("complete") || s.includes("closed") || s.includes("done")) return "done";
  if (s === "awaiting_pr_review") return "pr_review";
  if (s === "awaiting_approval" || s === "ready_for_verification") return "approval";
  if (s === "staged" || s === "planning" || s === "active") return "current";
  return "pending";
}

async function fetchProjectPhases(projectId: string): Promise<RepoStagedPhasesResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/staged/phases`);
  if (!res.ok) throw new Error(`Failed to fetch phases: ${res.status}`);
  return res.json() as Promise<RepoStagedPhasesResult>;
}

async function fetchProjectSprints(projectId: string): Promise<RepoStagedSprintsResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/staged/sprints`);
  if (!res.ok) throw new Error(`Failed to fetch sprints: ${res.status}`);
  return res.json() as Promise<RepoStagedSprintsResult>;
}

async function fetchProjectTasks(projectId: string): Promise<RepoStagedTasksResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/staged/tasks`);
  if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
  return res.json() as Promise<RepoStagedTasksResult>;
}

async function fetchPipelineSprints(pipelineId: string): Promise<StagedSprintsResult> {
  const res = await fetch(`/api/pipelines/${encodeURIComponent(pipelineId)}/staged/sprints`);
  if (!res.ok) throw new Error(`Failed to fetch pipeline sprints: ${res.status}`);
  return res.json() as Promise<StagedSprintsResult>;
}

async function fetchPipelineTasks(pipelineId: string): Promise<StagedTasksResult> {
  const res = await fetch(`/api/pipelines/${encodeURIComponent(pipelineId)}/staged/tasks`);
  if (!res.ok) throw new Error(`Failed to fetch pipeline tasks: ${res.status}`);
  return res.json() as Promise<StagedTasksResult>;
}

/** Merge two arrays, deduplicating by key. Pipeline-level entries (which come from the
 *  artifact store and reflect the feature branch) take precedence over repo-level entries
 *  (which only reflect the default branch clone). */
function mergeById<T>(keyFn: (item: T) => string, base: T[], ...extras: T[][]): T[] {
  const map = new Map<string, T>();
  for (const item of base) map.set(keyFn(item), item);
  for (const extra of extras) {
    for (const item of extra) map.set(keyFn(item), item); // overwrite: pipeline wins
  }
  return Array.from(map.values());
}

/** Normalize a phase ID for comparison: lowercase, hyphens → underscores.
 *  Phase plan filenames produce "ph_ui_001" while sprint plan Phase: fields
 *  produce "PH-UI-001"; this makes them match. */
function normalizePhaseId(id: string): string {
  return id.toLowerCase().replace(/-/g, "_");
}

export function useProjectWork(projectId: string, activePipelineIds: string[] = []) {
  const phasesQuery = useQuery<RepoStagedPhasesResult>({
    queryKey: ["project-work-phases", projectId],
    queryFn: () => fetchProjectPhases(projectId),
    enabled: Boolean(projectId),
  });

  const sprintsQuery = useQuery<RepoStagedSprintsResult>({
    queryKey: ["project-work-sprints", projectId],
    queryFn: () => fetchProjectSprints(projectId),
    enabled: Boolean(projectId),
  });

  const tasksQuery = useQuery<RepoStagedTasksResult>({
    queryKey: ["project-work-tasks", projectId],
    queryFn: () => fetchProjectTasks(projectId),
    enabled: Boolean(projectId),
  });

  // Supplement with per-pipeline artifact-store data so sprints/tasks on feature branches
  // are visible even when the default branch clone hasn't received them yet.
  const pipelineSprintQueries = useQueries({
    queries: activePipelineIds.map((pid) => ({
      queryKey: ["pipeline-work-sprints", pid],
      queryFn: () => fetchPipelineSprints(pid),
      enabled: Boolean(pid),
      staleTime: 10_000,
    })),
  });

  const pipelineTaskQueries = useQueries({
    queries: activePipelineIds.map((pid) => ({
      queryKey: ["pipeline-work-tasks", pid],
      queryFn: () => fetchPipelineTasks(pid),
      enabled: Boolean(pid),
      staleTime: 10_000,
    })),
  });

  const pipelineSprints: StagedSprintRecord[] = pipelineSprintQueries.flatMap(
    (q) => q.data?.sprints ?? []
  );
  const pipelineTasks: StagedTaskRecord[] = pipelineTaskQueries.flatMap(
    (q) => q.data?.tasks ?? []
  );

  const isLoading = phasesQuery.isLoading || sprintsQuery.isLoading || tasksQuery.isLoading;
  const isError = phasesQuery.isError || sprintsQuery.isError || tasksQuery.isError;
  const error =
    phasesQuery.error ?? sprintsQuery.error ?? tasksQuery.error ?? null;

  const phases: WorkPhase[] | undefined =
    phasesQuery.data && sprintsQuery.data && tasksQuery.data
      ? phasesQuery.data.phases.map((phase) => {
          // Merge repo-level sprints with pipeline-level sprints; pipeline wins on conflict.
          const allSprints = mergeById(
            (s) => s.sprint_id,
            sprintsQuery.data.sprints,
            pipelineSprints
          );
          const normalizedPhaseId = normalizePhaseId(phase.phase_id);
          const phaseSprints = allSprints.filter(
            (s) => s.phase_id != null && normalizePhaseId(s.phase_id) === normalizedPhaseId
          );

          const allTasks = mergeById(
            (t) => t.task_id,
            tasksQuery.data.tasks,
            pipelineTasks
          );

          const sprints: WorkSprint[] = phaseSprints.map((sprint) => {
            const sprintTasks = allTasks.filter(
              (t) => t.sprint_id === sprint.sprint_id
            );

            const sprintWorkStatus = deriveSprintStatus(sprint.status);
            // If the sprint is active and there is a pipeline running, the first
            // pending task is the one currently being executed (sequential model).
            const isSprintActive =
              sprintWorkStatus === "current" && activePipelineIds.length > 0;
            let markedCurrent = false;

            const tasks: WorkTask[] = sprintTasks.map((task) => {
              if (task.status === "done") {
                return { ...task, workStatus: "done" as WorkStatus };
              }
              if (isSprintActive && !markedCurrent) {
                markedCurrent = true;
                return { ...task, workStatus: "current" as WorkStatus };
              }
              return { ...task, workStatus: "pending" as WorkStatus };
            });

            return {
              ...sprint,
              workStatus: sprintWorkStatus,
              tasks,
            };
          });

          return {
            ...phase,
            workStatus: derivePhaseStatus(phase.status),
            sprints,
          };
        })
      : undefined;

  return { phases, isLoading, isError, error };
}
