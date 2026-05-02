import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

export async function GET() {
  const res = await fetch(`${BACKEND}/projects?include_channels=true`, { cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: res.status });
  }
  return NextResponse.json(await res.json());
}

export async function POST(req: Request) {
  const body: unknown = await req.json();
  const res = await fetch(`${BACKEND}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data: unknown = await res.json();
  return NextResponse.json(data, { status: res.status });
}
