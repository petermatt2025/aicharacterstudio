import { route, requireUser } from "@/server/http";
import { getJob } from "@/server/generation";

export const GET = route<{ id: string }>(async (req, { params }) => ({ job: await getJob(await requireUser(req), (await params).id) }));
