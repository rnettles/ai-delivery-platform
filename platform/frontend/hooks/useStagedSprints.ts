import { useQuery } from "@tanstack/react-query";
import type { StagedSprintsResult } from "@/types";

async function fetchStagedSprints(pipelineId: string): Promise<StagedSprintsResult> {
  const res = await fetch(`/api/pipelines/${encodeURIComponent(pipelineId)}/staged/sprints`);
  if (!res.ok) throw new Error(`Failed to fetch staged sprints: ${res.status}`);
  return res.json() as Promise<StagedSprintsResult>;
}

export function useStagedSprints(pipelineId: string, refetchInterval?: number | false) {
  return useQuery<StagedSprintsResult>({
    queryKey: ["staged-sprints", pipelineId],
    queryFn: () => fetchStagedSprints(pipelineId),
    enabled: Boolean(pipelineId),
    refetchInterval: refetchInterval ?? false,
  });
}
