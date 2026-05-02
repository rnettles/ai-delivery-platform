"use client";

import { useQuery } from "@tanstack/react-query";
import { mapToUITimeline } from "@/lib/timeline-mapper";
import type { PipelineRun, PipelineStatus, UITimeline } from "@/types";

const ACTIVE_STATUSES: PipelineStatus[] = [
  "running",
  "awaiting_approval",
  "paused_takeover",
];

async function fetchPipelineClient(id: string): Promise<PipelineRun> {
  const res = await fetch(`/api/pipelines/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch pipeline: ${res.status}`);
  }
  return res.json() as Promise<PipelineRun>;
}

export interface UsePipelineResult {
  pipeline: PipelineRun | undefined;
  timeline: UITimeline | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  /** True while the pipeline is in an active status and polling is running. */
  isLive: boolean;
  /** True when the pipeline has reached a terminal status (polling has stopped). */
  isStale: boolean;
}

export function usePipeline(id: string): UsePipelineResult {
  const query = useQuery<PipelineRun, Error>({
    queryKey: ["pipeline", id],
    queryFn: () => fetchPipelineClient(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && ACTIVE_STATUSES.includes(status)) {
        return 5000;
      }
      return false;
    },
  });

  const status = query.data?.status;
  const isLive = Boolean(status && ACTIVE_STATUSES.includes(status));
  const isStale = Boolean(query.data && !isLive);

  const timeline = query.data ? mapToUITimeline(query.data) : undefined;

  return {
    pipeline: query.data,
    timeline,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isLive,
    isStale,
  };
}
