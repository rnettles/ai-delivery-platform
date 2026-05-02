import { NextResponse } from "next/server";

function getBackendUrl(): string {
  const url = process.env.BACKEND_URL;
  if (!url) throw new Error("BACKEND_URL environment variable is not set");
  return url;
}

export async function GET() {
  try {
    const res = await fetch(`${getBackendUrl()}/pr-gates`, { cache: "no-store" });
    const data: unknown = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
