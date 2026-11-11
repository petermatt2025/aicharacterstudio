import { z } from "zod";
import { route, requireUser } from "@/server/http";
import { updateProfile } from "@/server/accounts";
import { getBalance } from "@/server/credits";

export const GET = route(async (req) => {
  const u = await requireUser(req);
  return { user: u, credits: await getBalance(u.workspaceId) };
});

export const PATCH = route(async (req) => {
  const u = await requireUser(req);
  const { displayName } = z.object({ displayName: z.string().max(80) }).parse(await req.json());
  await updateProfile(u.id, displayName);
  return { ok: true };
});
