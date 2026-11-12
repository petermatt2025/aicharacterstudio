import JSZip from "jszip";
import { route, requireUser } from "@/server/http";
import { getJob } from "@/server/generation";
import { readAssetBytes } from "@/server/assets";
import { FILE_EXT } from "@/server/images";
import { AppError } from "@/server/errors";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const u = await requireUser(req);
  const job = await getJob(u, (await params).id);
  if (!job.outputs.length) throw new AppError("not_found", "No images to download yet");
  const zip = new JSZip();
  for (const o of job.outputs) {
    const { bytes, mime } = await readAssetBytes(u, o.assetId, "original");
    zip.file(`${job.featureKey}-${o.index + 1}.${FILE_EXT[mime] ?? "bin"}`, bytes);
  }
  zip.file("README.txt", "AI-generated (synthetic) images. Likeness, products and text may be inaccurate. Review before commercial use.\n");
  const buf = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  return new Response(buf as unknown as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${job.featureKey}-${job.id.slice(0, 8)}.zip"`, "Cache-Control": "private, no-store" } });
});
