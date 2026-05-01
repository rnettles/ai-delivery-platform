import { NextRequest, NextResponse } from "next/server";
import { fetchPipeline } from "@/lib/api-client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const pipeline = await fetchPipeline(id);
    return NextResponse.json(pipeline);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
