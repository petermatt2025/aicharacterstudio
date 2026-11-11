import { route, requireUser } from "@/server/http";
import { createQuote } from "@/server/generation";

export const POST = route(async (req) => createQuote(await requireUser(req), await req.json()));
