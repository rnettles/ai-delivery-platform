import { useQuery } from "@tanstack/react-query";
import { fetchProjectBranches } from "@/lib/api-client";
import type { PipelineStatus, ProjectBranchSummary } from "@/types";

const ACTIVE_STATUSES: PipelineStatus[] = [
  "running",
  "awaiting_approval",
  "awaiting_pr_review",
  "paused_takeover",
];

export function useProjectBranches(projectId: string) {
  return useQuery<ProjectBranchSummary[]>({
    queryKey: ["project-branches", projectId],
    queryFn: () => fetchProjectBranches(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) => {
      const branches = query.state.data;
      if (branches?.some((b) => ACTIVE_STATUSES.includes(b.status))) {
        return 5000;
      }
      return false;
    },
  });
}
