import { NextResponse } from "next/server";
import { one } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await one(`SELECT 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
