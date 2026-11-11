import { route, requireUser } from "@/server/http";
import { completeOnboarding } from "@/server/accounts";

export const POST = route(async (req) => {
  const u = await requireUser(req);
  await completeOnboarding(u.id);
  return { ok: true };
});
