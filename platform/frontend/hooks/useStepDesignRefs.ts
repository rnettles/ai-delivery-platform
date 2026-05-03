import { useQuery } from "@tanstack/react-query";
import type { PipelineRole } from "@/types";
import {
  parsePhasePlanRefs,
  parseBriefRefs,
  type DesignRef,
} from "@/lib/parse-design-refs";

// ── Artifact path selectors ───────────────────────────────────────────────────

function findPhasePlanArtifact(paths: string[]): string | null {
  return (
    paths.find(
      (p) => /phase_plan/i.test(p) && (p.endsWith(".md") || p.endsWith(".MD"))
    ) ?? null
  );
}

function findBriefArtifact(paths: string[]): string | null {
  return paths.find((p) => p.includes("AI_IMPLEMENTATION_BRIEF")) ?? null;
}

function selectArtifact(role: PipelineRole, paths: string[]): string | null {
  if (role === "planner") return findPhasePlanArtifact(paths);
  return findBriefArtifact(paths);
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchArtifactText(pipelineId: string, artifactPath: string): Promise<string> {
  const url = `/api/pipelines/${encodeURIComponent(pipelineId)}/artifact?path=${encodeURIComponent(artifactPath)}`;
  const res = await fetch(url);
  if (!res.ok) return "";
  return res.text();
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseStepDesignRefsResult {
  refs: DesignRef[];
  isLoading: boolean;
}

/**
 * Fetches the most relevant artifact for a pipeline role and parses its
 * design references.
 *
 * - **planner**: reads the phase plan and returns FR IDs + required artifacts.
 * - **sprint-controller / implementer / verifier**: reads the implementation
 *   brief and returns fr_ids_in_scope + any Design References file paths.
 *
 * Returns empty refs when no matching artifact is found or the content cannot
 * be parsed (non-fatal).
 */
export function useStepDesignRefs(
  pipelineId: string,
  role: PipelineRole,
  artifactPaths: string[]
): UseStepDesignRefsResult {
  const artifactPath = selectArtifact(role, artifactPaths);

  const { data, isLoading } = useQuery<string>({
    queryKey: ["step-design-refs", pipelineId, artifactPath],
    queryFn: () => fetchArtifactText(pipelineId, artifactPath!),
    enabled: Boolean(artifactPath),
    staleTime: 60_000,
  });

  const refs: DesignRef[] =
    artifactPath && data
      ? role === "planner"
        ? parsePhasePlanRefs(data)
        : parseBriefRefs(data)
      : [];

  return {
    refs,
    isLoading: isLoading && Boolean(artifactPath),
  };
}
