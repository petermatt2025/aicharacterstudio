import { route, requireUser } from "@/server/http";
import { usageReport, recentJobs } from "@/server/admin";

export const GET = route(async (req) => {
  const u = await requireUser(req);
  const days = req.nextUrl.searchParams.get("days") === "7" ? 7 : 30;
  return { report: await usageReport(u, days), jobs: await recentJobs(u) };
});
