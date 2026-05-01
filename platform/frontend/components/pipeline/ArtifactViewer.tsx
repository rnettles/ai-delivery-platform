"use client";

import { useQuery } from "@tanstack/react-query";

interface ArtifactViewerProps {
  pipelineId: string;
  path: string;
}

async function fetchArtifactContent(pipelineId: string, artifactPath: string): Promise<string> {
  const url = `/api/pipelines/${encodeURIComponent(pipelineId)}/artifact?path=${encodeURIComponent(artifactPath)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to load artifact: ${res.status}`);
  }
  return res.text();
}

export function ArtifactViewer({ pipelineId, path }: ArtifactViewerProps) {
  const { data, isLoading, isError, error } = useQuery<string, Error>({
    queryKey: ["artifact", pipelineId, path],
    queryFn: () => fetchArtifactContent(pipelineId, path),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-3 rounded bg-gray-200" />
        <div className="h-3 w-4/5 rounded bg-gray-200" />
        <div className="h-3 w-3/5 rounded bg-gray-200" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-xs text-red-600">{error?.message ?? "Failed to load artifact."}</p>
    );
  }

  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-xs text-gray-800 leading-relaxed">
      {data}
    </pre>
  );
}
