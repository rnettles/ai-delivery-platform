import { useQuery } from "@tanstack/react-query";

export interface DesignArtifactEntry {
  path: string;
  filename: string;
  category: "fr" | "prd" | "adr" | "tdn";
}

export interface ProjectDesignArtifactsResult {
  project_id: string;
  fr: DesignArtifactEntry[];
  prd: DesignArtifactEntry[];
  adr: DesignArtifactEntry[];
  tdn: DesignArtifactEntry[];
  total: number;
}

async function fetchDesignArtifacts(projectId: string): Promise<ProjectDesignArtifactsResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/design-artifacts`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch design artifacts: ${res.status}`);
  }
  return res.json() as Promise<ProjectDesignArtifactsResult>;
}

export function useDesignArtifacts(projectId: string) {
  return useQuery<ProjectDesignArtifactsResult>({
    queryKey: ["design-artifacts", projectId],
    queryFn: () => fetchDesignArtifacts(projectId),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
}
