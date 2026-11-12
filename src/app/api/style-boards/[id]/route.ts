import { route, requireUser } from "@/server/http";
import { deleteBoard, getBoard, updateBoard } from "@/server/style-boards";

type P = { id: string };
export const GET = route<P>(async (req, { params }) => ({ board: await getBoard(await requireUser(req), (await params).id) }));
export const PATCH = route<P>(async (req, { params }) => ({ board: await updateBoard(await requireUser(req), (await params).id, await req.json()) }));
export const DELETE = route<P>(async (req, { params }) => deleteBoard(await requireUser(req), (await params).id));
