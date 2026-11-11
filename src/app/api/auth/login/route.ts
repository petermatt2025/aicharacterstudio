import { NextResponse } from "next/server";
import { route, setSessionCookie, clientIp } from "@/server/http";
import { login } from "@/server/accounts";
import { rateLimit } from "@/server/rate-limit";
import { getSetting } from "@/server/seed";

export const POST = route(async (req) => {
  await rateLimit(`auth:${clientIp(req)}`, await getSetting<number>("rate_limit_auth_per_15min"), 900);
  const s = await login(await req.json());
  return setSessionCookie(NextResponse.json({ ok: true }), s.token, s.maxAgeSeconds);
});
