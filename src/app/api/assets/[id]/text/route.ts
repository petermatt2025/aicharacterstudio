import { route, requireUser } from "@/server/http";
import { saveTextOverlay } from "@/server/text-overlay";
import { assetView } from "@/server/views";
import { AppError } from "@/server/errors";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser(req);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("validation_failed", "Missing image.");
  if (file.size > 40 * 1024 * 1024) throw new AppError("file_too_large", "Image is too large.");
  const texts = JSON.parse(String(form.get("texts") ?? "[]")) as unknown;
  const asset = await saveTextOverlay(user, (await params).id, Buffer.from(await file.arrayBuffer()), { texts: texts as string[] });
  return { asset: assetView(asset) };
});
