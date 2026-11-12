import { route, requireUser } from "@/server/http";
import { analyzeImage } from "@/server/image-to-prompt";

export const POST = route(async (req) => ({ analysis: await analyzeImage(await requireUser(req), await req.json()) }));
