import { route, requireUser } from "@/server/http";
import { patchSetting } from "@/server/admin";

export const PATCH = route<{ key: string }>(async (req, { params }) => {
  const body = (await req.json()) as { value: unknown };
  await patchSetting(await requireUser(req), (await params).key, body.value);
  return { ok: true };
});
