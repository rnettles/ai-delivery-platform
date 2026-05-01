import { NextRequest, NextResponse } from "next/server";
import { fetchArtifact } from "@/lib/api-client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const artifactPath = req.nextUrl.searchParams.get("path");

  if (!artifactPath) {
    return NextResponse.json({ error: "Query param 'path' is required" }, { status: 400 });
  }

  try {
    const content = await fetchArtifact(id, artifactPath);
    return new NextResponse(content, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
