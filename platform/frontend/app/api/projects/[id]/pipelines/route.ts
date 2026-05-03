import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

// All statuses — backend default is active-only; we want the full list
const ALL_STATUSES =
  "running,awaiting_approval,paused_takeover,awaiting_pr_review,failed,complete,cancelled";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Fetch the project and return its first channel_id, or null if none assigned. */
async function resolveChannelId(projectId: string): Promise<{ channelId: string | null; status: number }> {
  const projectRes = await fetch(`${BACKEND}/projects/${encodeURIComponent(projectId)}`, {
    cache: "no-store",
  });
  if (!projectRes.ok) return { channelId: null, status: projectRes.status };
  const project = (await projectRes.json()) as { channel_ids?: string[] };
  return { channelId: project.channel_ids?.[0] ?? null, status: 200 };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { id } = await params;

  const { channelId, status } = await resolveChannelId(id);
  if (status !== 200) {
    return NextResponse.json({ error: "Project not found" }, { status });
  }
  if (!channelId) {
    return NextResponse.json([]);
  }

  // Step 2: fetch pipelines for the channel (all statuses, limit 50)
  const url = new URL(`${BACKEND}/pipeline/status-summary/by-channel`);
  url.searchParams.set("channel_id", channelId);
  url.searchParams.set("limit", "50");
  url.searchParams.set("status", ALL_STATUSES);

  const pipelinesRes = await fetch(url.toString(), { cache: "no-store" });
  if (!pipelinesRes.ok) {
    return NextResponse.json(
      { error: "Failed to fetch pipelines" },
      { status: pipelinesRes.status }
    );
  }

  const body = (await pipelinesRes.json()) as { runs?: unknown[] };
  // Backend returns { channel_id, runs[] } — unwrap to plain array
  return NextResponse.json(body.runs ?? []);
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const { channelId, status } = await resolveChannelId(id);
  if (status !== 200) {
    return NextResponse.json({ error: "Project not found" }, { status });
  }
  if (!channelId) {
    return NextResponse.json({ error: "Project has no channel assigned" }, { status: 422 });
  }

  const body = (await req.json()) as {
    entry_point?: string;
    execution_mode?: string;
    description?: string;
    sprint_branch?: string;
    prior_pipeline_id?: string;
  };

  const pipelineRes = await fetch(`${BACKEND}/pipeline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entry_point: body.entry_point ?? "planner",
      execution_mode: body.execution_mode,
      sprint_branch: body.sprint_branch || undefined,
      input: {
        description: body.description ?? "",
        ...(body.prior_pipeline_id ? { prior_pipeline_id: body.prior_pipeline_id } : {}),
      },
      metadata: { source: "api", slack_channel: channelId },
    }),
  });

  if (!pipelineRes.ok) {
    const err = await pipelineRes.json().catch(() => ({})) as { error?: { message?: string } };
    return NextResponse.json(
      { error: err.error?.message ?? "Failed to create pipeline" },
      { status: pipelineRes.status }
    );
  }

  return NextResponse.json(await pipelineRes.json(), { status: 202 });
}
