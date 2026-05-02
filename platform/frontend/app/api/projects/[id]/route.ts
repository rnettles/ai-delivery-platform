import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  const res = await fetch(`${BACKEND}/projects/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json({ error: "Project not found" }, { status: res.status });
  }
  return NextResponse.json(await res.json());
}
