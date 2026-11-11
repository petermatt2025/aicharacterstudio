import { route, requireUser } from "@/server/http";
import { listAssets, uploadAsset } from "@/server/assets";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";
import { assetView as view } from "@/server/views";

export const GET = route(async (req) => {
  const u = await requireUser(req);
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const rows = await listAssets(u, sp);
  return { assets: rows.map(view) };
});

export const POST = route(async (req) => {
  const u = await requireUser(req);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > env().MAX_UPLOAD_BYTES + 64 * 1024) throw new AppError("file_too_large", "File is too large.");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("validation_failed", "Missing file");
  const bytes = Buffer.from(await file.arrayBuffer());
  const a = await uploadAsset(u, { kind: String(form.get("kind")) as never, consent: String(form.get("consent")) as never, title: String(form.get("title") ?? "") }, bytes, file.name || "upload");
  return { asset: view(a) };
});

