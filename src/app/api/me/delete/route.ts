import { z } from "zod";
import { NextResponse } from "next/server";
import { route, requireUser, clearSessionCookie } from "@/server/http";
import { deleteAccount } from "@/server/deletion";

export const POST = route(async (req) => {
  const u = await requireUser(req);
  const b = z.object({ password: z.string().max(200), confirm: z.literal("DELETE"), reason: z.string().max(500).optional() }).parse(await req.json());
  const r = await deleteAccount(u, b.password, b.reason);
  return clearSessionCookie(NextResponse.json({ ok: true, ...r }));
});
