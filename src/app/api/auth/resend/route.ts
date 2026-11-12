import { route, requireUser } from "@/server/http";
import { reportEmailFailure, sendVerificationEmail } from "@/server/accounts";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";

export const POST = route(async (req) => {
  const u = await requireUser(req);
  if (u.emailVerified) return { ok: true, alreadyVerified: true };
  await rateLimit(`resend:${u.id}`, 3, 3600);
  try {
    await sendVerificationEmail(u.id, u.email);
  } catch (e) {
    await reportEmailFailure("verification", u.email, e);
    throw new AppError("email_unavailable", "We couldn't send the email right now. We've been notified; please try again later or contact support.");
  }
  return { ok: true };
});
