import { NextResponse } from "next/server";
import { route, clientIp, setSessionCookie } from "@/server/http";
import { resetPassword } from "@/server/accounts";
import { rateLimit } from "@/server/rate-limit";
import { getSetting } from "@/server/seed";

export const POST = route(async (req) => {
  await rateLimit(`auth:${clientIp(req)}`, await getSetting<number>("rate_limit_auth_per_15min"), 900);
  const body = (await req.json()) as { token?: string; password?: string };
  const s = await resetPassword(String(body.token ?? ""), String(body.password ?? ""));
  return setSessionCookie(NextResponse.json({ ok: true }), s.token, s.maxAgeSeconds);
});
