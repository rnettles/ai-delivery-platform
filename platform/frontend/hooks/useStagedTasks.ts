import { useQuery } from "@tanstack/react-query";
import type { StagedTasksResult } from "@/types";

async function fetchStagedTasks(pipelineId: string): Promise<StagedTasksResult> {
  const res = await fetch(`/api/pipelines/${encodeURIComponent(pipelineId)}/staged/tasks`);
  if (!res.ok) throw new Error(`Failed to fetch staged tasks: ${res.status}`);
  return res.json() as Promise<StagedTasksResult>;
}

export function useStagedTasks(pipelineId: string, refetchInterval?: number | false) {
  return useQuery<StagedTasksResult>({
    queryKey: ["staged-tasks", pipelineId],
    queryFn: () => fetchStagedTasks(pipelineId),
    enabled: Boolean(pipelineId),
    refetchInterval: refetchInterval ?? false,
  });
}
