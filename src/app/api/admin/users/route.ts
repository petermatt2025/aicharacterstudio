import { z } from "zod";
import { route, requireUser } from "@/server/http";
import { assertAdmin, listUsers, adminGrantCredits } from "@/server/admin";
import { adminResetLink, adminVerifyEmail, setBetaAllowlist } from "@/server/accounts";

export const GET = route(async (req) => ({ users: await listUsers(await requireUser(req), req.nextUrl.searchParams.get("q") ?? "") }));

export const POST = route(async (req) => {
  const admin = await requireUser(req);
  assertAdmin(admin);
  const b = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("beta"), userId: z.string().uuid(), on: z.boolean() }),
      z.object({ action: z.literal("grant"), workspaceId: z.string().uuid(), amount: z.number().int(), note: z.string() }),
      z.object({ action: z.literal("verify"), userId: z.string().uuid() }),
      z.object({ action: z.literal("reset_link"), userId: z.string().uuid() }),
    ])
    .parse(await req.json());
  if (b.action === "beta") await setBetaAllowlist(admin.id, b.userId, b.on);
  else if (b.action === "grant") await adminGrantCredits(admin, b.workspaceId, b.amount, b.note);
  else if (b.action === "verify") return { ok: true, ...(await adminVerifyEmail(admin.id, b.userId)) };
  else return { ok: true, ...(await adminResetLink(admin.id, b.userId)) };
  return { ok: true };
});
