import { route, requireUser } from "@/server/http";
import { describeBoard } from "@/server/style-boards";

export const POST = route<{ id: string }>(async (req, { params }) => describeBoard(await requireUser(req), (await params).id));
