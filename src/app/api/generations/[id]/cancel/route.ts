import { route, requireUser } from "@/server/http";
import { cancelJob } from "@/server/generation";

export const POST = route<{ id: string }>(async (req, { params }) => cancelJob(await requireUser(req), (await params).id));
