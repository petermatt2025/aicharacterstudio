import { route, requireUser } from "@/server/http";
import { createBoard, listBoards } from "@/server/style-boards";

export const GET = route(async (req) => ({ boards: await listBoards(await requireUser(req)) }));
export const POST = route(async (req) => ({ board: await createBoard(await requireUser(req), await req.json()) }));
