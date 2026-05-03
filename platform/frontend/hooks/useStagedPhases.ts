import { useQuery } from "@tanstack/react-query";
import type { StagedPhasesResult } from "@/types";

async function fetchStagedPhases(pipelineId: string): Promise<StagedPhasesResult> {
  const res = await fetch(`/api/pipelines/${encodeURIComponent(pipelineId)}/staged/phases`);
  if (!res.ok) throw new Error(`Failed to fetch staged phases: ${res.status}`);
  return res.json() as Promise<StagedPhasesResult>;
}

export function useStagedPhases(pipelineId: string, refetchInterval?: number | false) {
  return useQuery<StagedPhasesResult>({
    queryKey: ["staged-phases", pipelineId],
    queryFn: () => fetchStagedPhases(pipelineId),
    enabled: Boolean(pipelineId),
    refetchInterval: refetchInterval ?? false,
  });
}
