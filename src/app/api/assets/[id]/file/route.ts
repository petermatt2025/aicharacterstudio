import { route, requireUser } from "@/server/http";
import { readAssetBytes } from "@/server/assets";
import { FILE_EXT } from "@/server/images";

/** Authorized on every request; never a public or long-lived URL. Supports byte ranges (needed for video in Safari). */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const u = await requireUser(req);
  const variant = req.nextUrl.searchParams.get("variant") === "thumb" ? "thumb" : "original";
  const { asset, bytes, mime } = await readAssetBytes(u, (await params).id, variant);
  const download = req.nextUrl.searchParams.get("download") === "1";
  const name = `${(asset.title || asset.id).replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "-") || asset.id}.${FILE_EXT[mime] ?? "webp"}`;
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Cache-Control": "private, max-age=300",
    "Content-Security-Policy": "default-src 'none'",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    ...(download ? { "Content-Disposition": `attachment; filename="${name}"` } : {}),
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && !download) {
    const size = bytes.length;
    let start = range[1] ? Number(range[1]) : NaN;
    let end = range[2] ? Number(range[2]) : size - 1;
    if (Number.isNaN(start)) {
      start = Math.max(0, size - end); // suffix range: last N bytes
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  return new Response(new Uint8Array(bytes), { headers });
});
