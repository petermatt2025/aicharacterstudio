import { route, requireUser } from "@/server/http";
import { createCharacter, listCharacters } from "@/server/assets";

export const GET = route(async (req) => ({ characters: await listCharacters(await requireUser(req)) }));
export const POST = route(async (req) => ({ character: await createCharacter(await requireUser(req), await req.json()) }));
