"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PipelineAction } from "@/types";

export interface ActionPayload {
  actor?: string;
  justification?: string;
  artifact_path?: string;
}

interface SubmitArgs {
  action: PipelineAction;
  payload?: ActionPayload;
}

async function postAction(pipelineId: string, { action, payload }: SubmitArgs): Promise<void> {
  const res = await fetch(`/api/pipelines/${encodeURIComponent(pipelineId)}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Action ${action} failed: ${res.status}`);
  }
}

export function useActions(pipelineId: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation<void, Error, SubmitArgs>({
    mutationFn: (args) => postAction(pipelineId, args),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pipeline", pipelineId] });
    },
  });

  return {
    submit: (action: PipelineAction, payload?: ActionPayload) =>
      mutation.mutate({ action, payload }),
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
