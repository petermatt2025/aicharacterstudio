import "server-only";
import sharp, { type Metadata } from "sharp";
import { AppError } from "./errors";

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";
const FORMAT_TO_MIME: Record<string, ImageMime> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
export const EXT: Record<ImageMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 8192;
const MIN_EDGE = 64;

export type CleanImage = { bytes: Buffer; mime: ImageMime; width: number; height: number };

/**
 * Decode and re-encode an untrusted image:
 * - sniff real format from bytes (ignore client MIME/extension), allow only PNG/JPEG/WebP
 * - enforce pixel and edge limits (decompression-bomb guard via limitInputPixels)
 * - apply EXIF orientation, then drop ALL metadata (EXIF, GPS, XMP, ICC beyond sRGB)
 */
export async function sanitizeImage(input: Buffer, opts: { maxBytes: number }): Promise<CleanImage> {
  if (input.length > opts.maxBytes) throw new AppError("file_too_large", `Images must be under ${Math.round(opts.maxBytes / 1024 / 1024)} MB.`);
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
  } catch {
    throw new AppError("unsupported_file", "This file is not a readable PNG, JPEG or WebP image.");
  }
  const mime = meta.format ? FORMAT_TO_MIME[meta.format] : undefined;
  if (!mime) throw new AppError("unsupported_file", "Only PNG, JPEG and WebP images are supported.");
  if ((meta.pages ?? 1) > 1) throw new AppError("unsupported_file", "Animated images are not supported.");
  const w = meta.width ?? 0, h = meta.height ?? 0;
  if (w < MIN_EDGE || h < MIN_EDGE) throw new AppError("unsupported_file", `Images must be at least ${MIN_EDGE}px on each side.`);
  if (w > MAX_EDGE || h > MAX_EDGE || w * h > MAX_PIXELS) throw new AppError("file_too_large", "Image dimensions are too large.");

  let pipeline = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate(); // bake orientation; metadata is not copied by default
  if (mime === "image/jpeg") pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true });
  else if (mime === "image/png") pipeline = pipeline.png({ compressionLevel: 8 });
  else pipeline = pipeline.webp({ quality: 92 });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { bytes: data, mime, width: info.width, height: info.height };
}

export async function makeThumbnail(input: Buffer): Promise<Buffer> {
  return sharp(input).resize(512, 512, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
}

export async function resizeLongEdge(input: Buffer, maxEdge: number): Promise<Buffer> {
  return sharp(input).resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true }).toBuffer();
}

/** Visible trial watermark applied after generation (Free plan). */
export async function applyWatermark(input: Buffer, label: string): Promise<Buffer> {
  const img = sharp(input);
  const { width = 1024, height = 1024 } = await img.metadata();
  const fontSize = Math.max(16, Math.round(width / 36));
  const safe = label.replace(/[<>&"']/g, "");
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>.t{font:600 ${fontSize}px sans-serif;fill:rgba(255,255,255,0.75);stroke:rgba(0,0,0,0.35);stroke-width:1}</style>
      <text x="${width - fontSize}" y="${height - fontSize}" text-anchor="end" class="t">${safe}</text>
    </svg>`,
  );
  return img.composite([{ input: svg, top: 0, left: 0 }]).toBuffer();
}

export async function inspect(input: Buffer) {
  const m = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  return { width: m.width ?? 0, height: m.height ?? 0, mime: m.format ? FORMAT_TO_MIME[m.format] : undefined, hasExif: !!m.exif };
}
