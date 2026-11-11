import { route, requireUser } from "@/server/http";
import { sendVerificationEmail } from "@/server/accounts";
import { rateLimit } from "@/server/rate-limit";

export const POST = route(async (req) => {
  const u = await requireUser(req);
  if (u.emailVerified) return { ok: true, alreadyVerified: true };
  await rateLimit(`resend:${u.id}`, 3, 3600);
  await sendVerificationEmail(u.id, u.email);
  return { ok: true };
});
