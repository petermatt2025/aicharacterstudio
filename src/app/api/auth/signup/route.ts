import { NextResponse } from "next/server";
import { route, setSessionCookie, clientIp } from "@/server/http";
import { signup, createSession } from "@/server/accounts";
import { rateLimit } from "@/server/rate-limit";
import { getSetting } from "@/server/seed";

export const POST = route(async (req) => {
  await rateLimit(`auth:${clientIp(req)}`, await getSetting<number>("rate_limit_auth_per_15min"), 900);
  const body = await req.json();
  const u = await signup(body);
  const s = await createSession(u.id);
  return setSessionCookie(NextResponse.json({ ok: true, verificationSent: true }), s.token, s.maxAgeSeconds);
});
