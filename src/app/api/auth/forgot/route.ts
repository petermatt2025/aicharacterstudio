import { route, clientIp } from "@/server/http";
import { requestPasswordReset } from "@/server/accounts";
import { rateLimit } from "@/server/rate-limit";
import { getSetting } from "@/server/seed";

export const POST = route(async (req) => {
  await rateLimit(`auth:${clientIp(req)}`, await getSetting<number>("rate_limit_auth_per_15min"), 900);
  const body = (await req.json()) as { email?: string };
  return requestPasswordReset(String(body.email ?? ""));
});
