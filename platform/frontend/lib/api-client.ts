import type { PipelineRun } from "@/types";

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
