import { route, requireUser } from "@/server/http";
import { createTopupCheckout } from "@/server/billing";

export const POST = route(async (req) => createTopupCheckout(await requireUser(req), await req.json()));
