import { useQuery } from "@tanstack/react-query";
import { fetchProjectPipelines } from "@/lib/api-client";
import type { PipelineStatusChoice, PipelineStatus } from "@/types";

const ACTIVE_STATUSES: PipelineStatus[] = [
  "running",
  "awaiting_approval",
  "awaiting_pr_review",
  "paused_takeover",
];

export function useProjectPipelines(projectId: string) {
  const query = useQuery<PipelineStatusChoice[]>({
    queryKey: ["project-pipelines", projectId],
    queryFn: () => fetchProjectPipelines(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) => {
      const pipelines = query.state.data;
      if (pipelines?.some((p) => ACTIVE_STATUSES.includes(p.status))) {
        return 5000;
      }
      return false;
    },
  });

  const isLive = Boolean(
    query.data?.some((p) => ACTIVE_STATUSES.includes(p.status))
  );

  return { ...query, isLive };
}
