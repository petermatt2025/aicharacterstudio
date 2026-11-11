import { route, requireUser } from "@/server/http";
import { readAssetBytes } from "@/server/assets";
import { EXT } from "@/server/images";

/** Authorized on every request; never a public or long-lived URL. */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const u = await requireUser(req);
  const variant = req.nextUrl.searchParams.get("variant") === "thumb" ? "thumb" : "original";
  const { asset, bytes, mime } = await readAssetBytes(u, (await params).id, variant);
  const download = req.nextUrl.searchParams.get("download") === "1";
  const name = `${(asset.title || asset.id).replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "-") || asset.id}.${EXT[mime as keyof typeof EXT] ?? "webp"}`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=300",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      ...(download ? { "Content-Disposition": `attachment; filename="${name}"` } : {}),
    },
  });
});
