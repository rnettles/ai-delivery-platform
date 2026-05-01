import type { PipelineAction, PipelineRun } from "@/types";

const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) {
  throw new Error("BACKEND_URL environment variable is not set");
}

export async function fetchPipeline(pipelineId: string): Promise<PipelineRun> {
  const url = `${BACKEND_URL}/pipeline/${encodeURIComponent(pipelineId)}`;
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`Backend responded ${res.status} for pipeline ${pipelineId}`);
  }

  return res.json() as Promise<PipelineRun>;
}

export async function fetchArtifact(
  pipelineId: string,
  artifactPath: string,
): Promise<string> {
  const url = new URL(
    `${BACKEND_URL}/pipeline/${encodeURIComponent(pipelineId)}/artifact`,
  );
  url.searchParams.set("path", artifactPath);
  const res = await fetch(url.toString(), { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`Backend responded ${res.status} for artifact ${artifactPath}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json: unknown = await res.json();
    return JSON.stringify(json, null, 2);
  }
  return res.text();
}

/** Maps a PipelineAction to the backend route suffix */
const ACTION_ROUTE: Record<PipelineAction, string> = {
  approve: "approve",
  cancel: "cancel",
  retry: "retry",
  takeover: "takeover",
  handoff: "handoff",
  skip: "skip",
};

export async function submitPipelineAction(
  pipelineId: string,
  action: PipelineAction,
  payload: Record<string, unknown>,
): Promise<PipelineRun> {
  const route = ACTION_ROUTE[action];
  const url = `${BACKEND_URL}/pipeline/${encodeURIComponent(pipelineId)}/${route}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Action ${action} failed: ${res.status}`);
  }

  return res.json() as Promise<PipelineRun>;
}
