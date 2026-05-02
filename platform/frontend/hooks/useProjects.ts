import { useQuery } from "@tanstack/react-query";
import { fetchProjects } from "@/lib/api-client";
import type { ProjectWithChannels } from "@/types/project";

export function useProjects() {
  return useQuery<ProjectWithChannels[]>({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });
}
