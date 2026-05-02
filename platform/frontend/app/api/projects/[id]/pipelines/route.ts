import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

// All statuses — backend default is active-only; we want the full list
const ALL_STATUSES =
  "running,awaiting_approval,paused_takeover,awaiting_pr_review,failed,complete,cancelled";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { id } = await params;

  // Step 1: fetch project to get channel_id
  const projectRes = await fetch(`${BACKEND}/projects/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (!projectRes.ok) {
    return NextResponse.json({ error: "Project not found" }, { status: projectRes.status });
  }
  const project = (await projectRes.json()) as { channels?: { channel_id: string }[] };

  const channelId = project.channels?.[0]?.channel_id;
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
