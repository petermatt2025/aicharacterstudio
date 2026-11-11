import { z } from "zod";
import { NextResponse } from "next/server";
import { route, requireUser, clearSessionCookie } from "@/server/http";
import { changePassword } from "@/server/accounts";

export const POST = route(async (req) => {
  const u = await requireUser(req);
  const b = z.object({ current: z.string().max(200), next: z.string().min(10).max(200) }).parse(await req.json());
  await changePassword(u.id, b.current, b.next);
  return clearSessionCookie(NextResponse.json({ ok: true, signedOut: true }));
});
