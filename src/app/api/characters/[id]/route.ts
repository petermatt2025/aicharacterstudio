import { route, requireUser } from "@/server/http";
import { deleteCharacter, getCharacter, updateCharacter } from "@/server/assets";

export const GET = route<{ id: string }>(async (req, { params }) => ({ character: await getCharacter(await requireUser(req), (await params).id) }));
export const PATCH = route<{ id: string }>(async (req, { params }) => ({ character: await updateCharacter(await requireUser(req), (await params).id, await req.json()) }));
export const DELETE = route<{ id: string }>(async (req, { params }) => deleteCharacter(await requireUser(req), (await params).id));
