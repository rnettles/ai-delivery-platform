import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const url = new URL(req.url);
  const filePath = url.searchParams.get("path") ?? "";

  if (!filePath) {
    return NextResponse.json({ error: "Query param 'path' is required" }, { status: 400 });
  }

  const res = await fetch(
    `${BACKEND}/projects/${encodeURIComponent(id)}/design-artifacts/content?path=${encodeURIComponent(filePath)}`,
    { cache: "no-store" }
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: "Failed to fetch artifact content" }))) as {
      error?: string;
    };
    return NextResponse.json({ error: body.error ?? "Failed to fetch artifact content" }, { status: res.status });
  }

  const contentType = res.headers.get("content-type") ?? "text/plain";
  const text = await res.text();

  return new NextResponse(text, {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}
