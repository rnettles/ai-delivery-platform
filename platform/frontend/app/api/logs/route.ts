import { NextResponse } from "next/server";

function getBackendUrl(): string {
  const url = process.env.BACKEND_URL;
  if (!url) throw new Error("BACKEND_URL environment variable is not set");
  return url;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") ?? "200";
  try {
    const res = await fetch(`${getBackendUrl()}/logs?limit=${encodeURIComponent(limit)}`, {
      cache: "no-store",
    });
    const data: unknown = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
