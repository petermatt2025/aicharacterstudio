import { z } from "zod";
import { route } from "@/server/http";
import { verifyEmail } from "@/server/accounts";

export const POST = route(async (req) => {
  const { token } = z.object({ token: z.string().min(10).max(200) }).parse(await req.json());
  const r = await verifyEmail(token);
  return { ok: true, trialGranted: r.trialGranted };
});
