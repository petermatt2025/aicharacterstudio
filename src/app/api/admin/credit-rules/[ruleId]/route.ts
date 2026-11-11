import { route, requireUser } from "@/server/http";
import { patchCreditRule } from "@/server/admin";

export const PATCH = route<{ ruleId: string }>(async (req, { params }) => ({ rule: await patchCreditRule(await requireUser(req), (await params).ruleId, await req.json()) }));
