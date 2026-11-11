import { z } from "zod";
import { route, requireUser } from "@/server/http";
import { assertAdmin, listUsers, adminGrantCredits } from "@/server/admin";
import { setBetaAllowlist } from "@/server/accounts";

export const GET = route(async (req) => ({ users: await listUsers(await requireUser(req), req.nextUrl.searchParams.get("q") ?? "") }));

export const POST = route(async (req) => {
  const admin = await requireUser(req);
  assertAdmin(admin);
  const b = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("beta"), userId: z.string().uuid(), on: z.boolean() }),
      z.object({ action: z.literal("grant"), workspaceId: z.string().uuid(), amount: z.number().int(), note: z.string() }),
    ])
    .parse(await req.json());
  if (b.action === "beta") await setBetaAllowlist(admin.id, b.userId, b.on);
  else await adminGrantCredits(admin, b.workspaceId, b.amount, b.note);
  return { ok: true };
});
