import type { PipelineAction, PipelineRun, PipelineStatusChoice, ProjectBranchSummary } from "@/types";
import type { ProjectWithChannels } from "@/types/project";

function getBackendUrl(): string {
  const url = process.env.BACKEND_URL;
  if (!url) throw new Error("BACKEND_URL environment variable is not set");
  return url;
}

export async function fetchPipeline(pipelineId: string): Promise<PipelineRun> {
  const BACKEND_URL = getBackendUrl();
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
    `${getBackendUrl()}/pipeline/${encodeURIComponent(pipelineId)}/artifact`,
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

export async function fetchProjectPipelines(projectId: string): Promise<PipelineStatusChoice[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pipelines`);
  if (!res.ok) throw new Error("Failed to fetch pipelines");
  return res.json() as Promise<PipelineStatusChoice[]>;
}

export async function fetchProjectBranches(projectId: string): Promise<ProjectBranchSummary[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/branches`);
  if (!res.ok) throw new Error("Failed to fetch project branches");
  return res.json() as Promise<ProjectBranchSummary[]>;
}

export async function fetchProjects(): Promise<ProjectWithChannels[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json() as Promise<ProjectWithChannels[]>;
}

export async function fetchProject(projectId: string): Promise<ProjectWithChannels> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error(`Failed to fetch project ${projectId}`);
  return res.json() as Promise<ProjectWithChannels>;
}

export async function createProject(opts: {
  name: string;
  repo_url: string;
  default_branch?: string;
  channel_id?: string;
  prompt_role: string;
  prompt_context?: string;
}): Promise<ProjectWithChannels> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Failed to create project: ${res.status}`);
  }
  return res.json() as Promise<ProjectWithChannels>;
}

export async function updateProjectPromptFields(
  projectId: string,
  promptRole: string,
  promptContext?: string,
): Promise<ProjectWithChannels> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/prompt-fields`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt_role: promptRole, prompt_context: promptContext ?? null }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Failed to update prompt fields: ${res.status}`);
  }
  return res.json() as Promise<ProjectWithChannels>;
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
  const url = `${getBackendUrl()}/pipeline/${encodeURIComponent(pipelineId)}/${route}`;
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
