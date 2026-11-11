import { route, requireUser } from "@/server/http";
import { createJob, listJobs } from "@/server/generation";

export const GET = route(async (req) => ({ jobs: await listJobs(await requireUser(req), Number(req.nextUrl.searchParams.get("limit") ?? 20)) }));
export const POST = route(async (req) => createJob(await requireUser(req), await req.json()));
