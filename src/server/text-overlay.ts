import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import type { SessionUser } from "./accounts";
import { tx } from "./db";
import { AppError } from "./errors";
import { getAsset } from "./assets";
import { sanitizeImage, makeThumbnail, EXT } from "./images";
import { storage } from "./storage";
import { moderate } from "./moderation";
import { rateLimit } from "./rate-limit";
import { env } from "./env";
import { track } from "./audit";
import { sha256 } from "./crypto";

export const textOverlayMetaSchema = z.object({
  texts: z.array(z.string().max(500)).min(1).max(12),
});

/**
 * Text Studio save: the browser renders the text layers onto the user's own image (exact fonts, instant, no AI)
 * and uploads the result. The server checks ownership, size match with the source, moderates the words and the
 * final image, then stores it as a NEW gallery image. The source is never modified.
 */
export async function saveTextOverlay(user: SessionUser, sourceId: string, bytes: Buffer, meta: z.input<typeof textOverlayMetaSchema>) {
  const { texts } = textOverlayMetaSchema.parse(meta);
  if (!user.emailVerified) throw new AppError("email_not_verified", "Verify your email first.");
  const source = await getAsset(user, sourceId); // ownership-checked
  await rateLimit(`textoverlay:${user.id}`, 60, 3600);

  const words = texts.map((t) => t.trim()).filter(Boolean).join("\n");
  if (!words) throw new AppError("validation_failed", "Add some text first.");
  const textCheck = await moderate({ text: words });
  if (textCheck.flagged) throw new AppError("moderation_blocked", "This text isn't allowed under our acceptable use policy.", { categories: textCheck.categories });

  const clean = await sanitizeImage(bytes, { maxBytes: 40 * 1024 * 1024 });
  if (Math.abs(clean.width - source.width) > 2 || Math.abs(clean.height - source.height) > 2) {
    throw new AppError("validation_failed", "The edited image doesn't match the original's size. Please try again.");
  }
  const thumb = await makeThumbnail(clean.bytes);
  const imgCheck = await moderate({ imageDataUrl: `data:image/webp;base64,${thumb.toString("base64")}` });
  if (imgCheck.flagged) throw new AppError("moderation_blocked", "This image can't be saved under our acceptable use policy.");

  const id = crypto.randomUUID();
  const key = `ws/${user.workspaceId}/outputs/text/${id}.${EXT[clean.mime]}`;
  const thumbKey = `ws/${user.workspaceId}/thumbs/${id}.webp`;
  await storage().put(key, clean.bytes, clean.mime);
  await storage().put(thumbKey, thumb, "image/webp");
  try {
    await tx(async (c) => {
      await c.query(
        `INSERT INTO assets (id, workspace_id, owner_user_id, kind, storage_key, thumb_key, title, mime, bytes, width, height, sha256, provenance, consent_receipt_id, moderation_status, feature_key, watermarked)
         VALUES ($1,$2,$3,'output',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [id, user.workspaceId, user.id, key, thumbKey, `${source.title} + text`.slice(0, 200), clean.mime, clean.bytes.length, clean.width, clean.height, sha256(clean.bytes),
          JSON.stringify({ source: "text_overlay", sourceAssetId: source.id, texts: texts.map((t) => t.slice(0, 200)) }),
          source.consent_receipt_id, env().MODERATION_PROVIDER === "openai" ? "passed" : "baseline_only", source.feature_key, source.watermarked],
      );
    });
  } catch (e) {
    await storage().delete(key).catch(() => {});
    await storage().delete(thumbKey).catch(() => {});
    throw e;
  }
  await track(user.id, "text_overlay_saved", { layers: texts.length });
  return getAsset(user, id);
}
