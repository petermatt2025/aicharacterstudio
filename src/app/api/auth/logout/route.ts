import { NextResponse } from "next/server";
import { route, clearSessionCookie, SESSION_COOKIE } from "@/server/http";
import { destroySession } from "@/server/accounts";

export const POST = route(async (req) => {
  const t = req.cookies.get(SESSION_COOKIE)?.value;
  if (t) await destroySession(t);
  return clearSessionCookie(NextResponse.json({ ok: true }));
});
