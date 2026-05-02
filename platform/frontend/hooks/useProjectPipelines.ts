import { useQuery } from "@tanstack/react-query";
import { fetchProjectPipelines } from "@/lib/api-client";
import type { PipelineStatusChoice } from "@/types";

export function useProjectPipelines(projectId: string) {
  return useQuery<PipelineStatusChoice[]>({
    queryKey: ["project-pipelines", projectId],
    queryFn: () => fetchProjectPipelines(projectId),
    enabled: Boolean(projectId),
  });
}
