import { NextResponse } from "next/server";
import { route, setSessionCookie, clientIp } from "@/server/http";
import { signup, createSession, devVerificationUrl } from "@/server/accounts";
import { rateLimit } from "@/server/rate-limit";
import { getSetting } from "@/server/seed";

export const POST = route(async (req) => {
  await rateLimit(`auth:${clientIp(req)}`, await getSetting<number>("rate_limit_auth_per_15min"), 900);
  const body = await req.json();
  const u = await signup(body, { ip: clientIp(req) });
  const s = await createSession(u.id);
  const devVerifyUrl = await devVerificationUrl(String(body.email ?? ""));
  return setSessionCookie(NextResponse.json({ ok: true, verificationSent: true, devVerifyUrl }), s.token, s.maxAgeSeconds);
});
