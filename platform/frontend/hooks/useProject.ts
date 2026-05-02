import { useQuery } from "@tanstack/react-query";
import { fetchProject } from "@/lib/api-client";
import type { ProjectWithChannels } from "@/types/project";

export function useProject(projectId: string) {
  return useQuery<ProjectWithChannels>({
    queryKey: ["projects", projectId],
    queryFn: () => fetchProject(projectId),
    enabled: Boolean(projectId),
  });
}
