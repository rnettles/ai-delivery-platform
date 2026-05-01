import { NextRequest, NextResponse } from "next/server";
import { submitPipelineAction } from "@/lib/api-client";
import type { PipelineAction } from "@/types";

const VALID_ACTIONS = new Set<PipelineAction>([
  "approve",
  "cancel",
  "retry",
  "takeover",
  "handoff",
  "skip",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action as PipelineAction | undefined;
  if (!action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json({ error: `Invalid or missing action: ${String(action)}` }, { status: 400 });
  }

  if (action === "skip" && typeof body.justification !== "string") {
    return NextResponse.json({ error: "justification is required for skip" }, { status: 400 });
  }

  // Build payload for backend — inject hardcoded actor (no auth in Slice 2)
  const payload: Record<string, unknown> = {
    actor: "operator",
  };
  if (typeof body.justification === "string") payload.justification = body.justification;
  if (typeof body.artifact_path === "string") payload.artifact_path = body.artifact_path;

  try {
    const run = await submitPipelineAction(id, action, payload);
    return NextResponse.json(run);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
