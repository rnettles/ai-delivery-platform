import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const body: unknown = await req.json();
  const res = await fetch(`${BACKEND}/projects/${encodeURIComponent(id)}/prompt-fields`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data: unknown = await res.json();
  return NextResponse.json(data, { status: res.status });
}
