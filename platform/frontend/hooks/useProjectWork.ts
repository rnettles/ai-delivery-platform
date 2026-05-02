import { useQuery } from "@tanstack/react-query";
import type {
  RepoStagedPhasesResult,
  RepoStagedSprintsResult,
  RepoStagedTasksResult,
  StagedPhaseRecord,
  StagedSprintRecord,
  StagedTaskRecord,
} from "@/types";

export type WorkStatus = "done" | "current" | "pending";

export interface WorkTask extends StagedTaskRecord {
  workStatus: "done" | "pending";
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
  if (s === "active" || s === "planning" || s === "approved" || s === "draft") return "current";
  return "pending";
}

function deriveSprintStatus(status: string): WorkStatus {
  const s = status.toLowerCase();
  if (s.includes("complete") || s.includes("closed") || s.includes("done")) return "done";
  if (
    s === "staged" ||
    s === "planning" ||
    s === "active" ||
    s === "ready_for_verification"
  )
    return "current";
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

export function useProjectWork(projectId: string) {
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

  const isLoading = phasesQuery.isLoading || sprintsQuery.isLoading || tasksQuery.isLoading;
  const isError = phasesQuery.isError || sprintsQuery.isError || tasksQuery.isError;
  const error =
    phasesQuery.error ?? sprintsQuery.error ?? tasksQuery.error ?? null;

  const phases: WorkPhase[] | undefined =
    phasesQuery.data && sprintsQuery.data && tasksQuery.data
      ? phasesQuery.data.phases.map((phase) => {
          const phaseSprints = sprintsQuery.data.sprints.filter(
            (s) => s.phase_id === phase.phase_id
          );

          const sprints: WorkSprint[] = phaseSprints.map((sprint) => {
            const sprintTasks = tasksQuery.data.tasks.filter(
              (t) => t.sprint_id === sprint.sprint_id
            );

            const tasks: WorkTask[] = sprintTasks.map((task) => ({
              ...task,
              workStatus: task.status === "done" ? "done" : "pending",
            }));

            return {
              ...sprint,
              workStatus: deriveSprintStatus(sprint.status),
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
