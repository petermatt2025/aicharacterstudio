import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { CONSENT_STATEMENTS, CONSENT_STATEMENT_VERSION } from "@/lib/catalog";
import type { SessionUser } from "./accounts";
import { one, q, tx } from "./db";
import { env } from "./env";
import { AppError } from "./errors";
import { EXT, makeThumbnail, sanitizeImage } from "./images";
import { moderate } from "./moderation";
import { rateLimit } from "./rate-limit";
import { getSetting } from "./seed";
import { storage } from "./storage";
import { sha256 } from "./crypto";
import { track } from "./audit";

export const ASSET_KINDS = ["character", "product", "outfit", "background", "style", "other"] as const;
export type UploadKind = (typeof ASSET_KINDS)[number];
export type ConsentSubject = "self" | "third_party_with_permission" | "no_identifiable_people" | "owned_product_or_asset";

/** Which consent statements are acceptable per upload kind. People-bearing kinds need person consent. */
export const ALLOWED_CONSENT: Record<UploadKind, ConsentSubject[]> = {
  character: ["self", "third_party_with_permission"],
  product: ["owned_product_or_asset", "no_identifiable_people", "self", "third_party_with_permission"],
  outfit: ["owned_product_or_asset", "no_identifiable_people", "self", "third_party_with_permission"],
  background: ["no_identifiable_people", "owned_product_or_asset", "self", "third_party_with_permission"],
  style: ["no_identifiable_people", "owned_product_or_asset", "self", "third_party_with_permission"],
  other: ["no_identifiable_people", "owned_product_or_asset", "self", "third_party_with_permission"],
};

export type AssetRow = {
  id: string;
  workspace_id: string;
  kind: string;
  storage_key: string;
  thumb_key: string | null;
  original_filename: string | null;
  title: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  feature_key: string | null;
  favorite: boolean;
  watermarked: boolean;
  moderation_status: string;
  consent_receipt_id: string | null;
  provenance: Record<string, unknown>;
  created_at: Date;
};

export const uploadMetaSchema = z.object({
  kind: z.enum(ASSET_KINDS),
  consent: z.enum(["self", "third_party_with_permission", "no_identifiable_people", "owned_product_or_asset"]),
  title: z.string().trim().max(120).default(""),
});

export function assetKeys(workspaceId: string, assetId: string, mime: keyof typeof EXT) {
  return { key: `ws/${workspaceId}/assets/${assetId}.${EXT[mime]}`, thumb: `ws/${workspaceId}/thumbs/${assetId}.webp` };
}

export async function uploadAsset(user: SessionUser, meta: z.input<typeof uploadMetaSchema>, bytes: Buffer, filename: string) {
  const m = uploadMetaSchema.parse(meta);
  if (!user.emailVerified) throw new AppError("email_not_verified", "Verify your email before uploading images.");
  if (!ALLOWED_CONSENT[m.kind].includes(m.consent)) {
    throw new AppError("consent_required", m.kind === "character" ? "Character photos require confirmation that you are the person shown or have their explicit permission." : "Please confirm your rights to this image.");
  }
  await rateLimit(`upload:${user.id}`, await getSetting<number>("rate_limit_uploads_per_hour"), 3600);

  const clean = await sanitizeImage(bytes, { maxBytes: env().MAX_UPLOAD_BYTES });
  const quotas = await getSetting<Record<string, number>>("storage_quota_mb");
  const used = await one<{ bytes: number }>(`SELECT COALESCE(sum(bytes),0)::bigint AS bytes FROM assets WHERE workspace_id=$1 AND deleted_at IS NULL`, [user.workspaceId]);
  if ((used?.bytes ?? 0) + clean.bytes.length > (quotas[user.planKey] ?? 200) * 1024 * 1024) {
    throw new AppError("file_too_large", "Storage quota reached. Delete unused images or upgrade your plan.");
  }

  const thumb = await makeThumbnail(clean.bytes);
  const mod = await moderate({ imageDataUrl: `data:image/webp;base64,${thumb.toString("base64")}` });
  if (mod.flagged) {
    await track(user.id, "upload_rejected_moderation", { categories: mod.categories });
    throw new AppError("moderation_blocked", "This image can't be used under our acceptable use policy.", { categories: mod.categories });
  }

  const id = crypto.randomUUID();
  const keys = assetKeys(user.workspaceId, id, clean.mime);
  await storage().put(keys.key, clean.bytes, clean.mime);
  await storage().put(keys.thumb, thumb, "image/webp");
  try {
    await tx(async (c) => {
      const receipt = await one<{ id: string }>(
        `INSERT INTO consent_receipts (user_id, workspace_id, subject, statement_version, statement) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [user.id, user.workspaceId, m.consent, CONSENT_STATEMENT_VERSION, CONSENT_STATEMENTS[m.consent]],
        c,
      );
      await c.query(
        `INSERT INTO assets (id, workspace_id, owner_user_id, kind, storage_key, thumb_key, original_filename, title, mime, bytes, width, height, sha256, provenance, consent_receipt_id, moderation_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [id, user.workspaceId, user.id, m.kind, keys.key, keys.thumb, filename.slice(0, 200), m.title || filename.slice(0, 120), clean.mime, clean.bytes.length, clean.width, clean.height,
          sha256(clean.bytes), JSON.stringify({ source: "upload" }), receipt!.id, mod.source === "openai" ? "passed" : "baseline_only"],
      );
    });
  } catch (e) {
    await storage().delete(keys.key).catch(() => {});
    await storage().delete(keys.thumb).catch(() => {});
    throw e;
  }
  await track(user.id, "asset_uploaded", { kind: m.kind });
  return getAsset(user, id);
}

export async function getAsset(user: SessionUser, id: string): Promise<AssetRow> {
  if (!z.string().uuid().safeParse(id).success) throw new AppError("not_found", "Image not found");
  const a = await one<AssetRow>(`SELECT * FROM assets WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, [id, user.workspaceId]);
  if (!a) throw new AppError("not_found", "Image not found"); // same error for other tenants: no existence leak
  return a;
}

export const listQuerySchema = z.object({
  kind: z.enum([...ASSET_KINDS, "output"]).optional(),
  featureKey: z.string().max(60).optional(),
  search: z.string().max(100).optional(),
  favorite: z.coerce.boolean().optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export async function listAssets(user: SessionUser, query: z.input<typeof listQuerySchema>) {
  const f = listQuerySchema.parse(query);
  const params: unknown[] = [user.workspaceId];
  const where = ["workspace_id=$1", "deleted_at IS NULL"];
  if (f.kind) where.push(`kind=$${params.push(f.kind)}`);
  if (f.featureKey) where.push(`feature_key=$${params.push(f.featureKey)}`);
  if (f.search) where.push(`(title ILIKE $${params.push(`%${f.search.replace(/[%_\\]/g, (s) => "\\" + s)}%`)})`);
  if (f.favorite) where.push(`favorite=true`);
  if (f.before) where.push(`created_at < $${params.push(f.before)}`);
  params.push(f.limit);
  return q<AssetRow>(`SELECT * FROM assets WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT $${params.length}`, params);
}

export async function updateAsset(user: SessionUser, id: string, patch: { title?: string; favorite?: boolean }) {
  await getAsset(user, id);
  const p = z.object({ title: z.string().trim().max(120).optional(), favorite: z.boolean().optional() }).parse(patch);
  await q(`UPDATE assets SET title=COALESCE($3,title), favorite=COALESCE($4,favorite) WHERE id=$1 AND workspace_id=$2`, [id, user.workspaceId, p.title ?? null, p.favorite ?? null]);
  return getAsset(user, id);
}

/** Soft-delete the row (jobs keep their history) and remove the stored objects immediately. */
export async function deleteAsset(user: SessionUser, id: string) {
  const a = await getAsset(user, id);
  await tx(async (c) => {
    await c.query(`UPDATE assets SET deleted_at=now() WHERE id=$1`, [a.id]);
    await c.query(`DELETE FROM character_profile_assets WHERE asset_id=$1`, [a.id]);
    await c.query(`UPDATE character_profiles SET primary_asset_id=NULL WHERE primary_asset_id=$1`, [a.id]);
  });
  await storage().delete(a.storage_key);
  if (a.thumb_key) await storage().delete(a.thumb_key);
  return { deleted: true };
}

export async function readAssetBytes(user: SessionUser, id: string, variant: "original" | "thumb") {
  const a = await getAsset(user, id);
  const key = variant === "thumb" && a.thumb_key ? a.thumb_key : a.storage_key;
  const bytes = await storage().get(key);
  return { asset: a, bytes, mime: variant === "thumb" && a.thumb_key ? "image/webp" : a.mime };
}

// ───────────── Character profiles ─────────────

export const characterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  assetIds: z.array(z.string().uuid()).min(1).max(8),
  identityStrength: z.enum(["loose", "balanced", "strict"]).default("balanced"),
  notes: z.string().trim().max(1000).default(""),
});

export type CharacterRow = { id: string; name: string; primary_asset_id: string | null; identity_strength: "loose" | "balanced" | "strict"; notes: string; created_at: Date; asset_ids: string[] };

async function assertCharacterAssets(user: SessionUser, ids: string[]) {
  const rows = await q<{ id: string; kind: string }>(`SELECT id, kind FROM assets WHERE id = ANY($1) AND workspace_id=$2 AND deleted_at IS NULL`, [ids, user.workspaceId]);
  if (rows.length !== new Set(ids).size) throw new AppError("not_found", "One or more images were not found");
  if (rows.some((r) => r.kind !== "character")) throw new AppError("validation_failed", "Character profiles can only use character photos (with person consent).");
}

export async function createCharacter(user: SessionUser, input: z.input<typeof characterSchema>) {
  const d = characterSchema.parse(input);
  await assertCharacterAssets(user, d.assetIds);
  const id = await tx(async (c) => {
    const p = await one<{ id: string }>(
      `INSERT INTO character_profiles (workspace_id, owner_user_id, name, primary_asset_id, identity_strength, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [user.workspaceId, user.id, d.name, d.assetIds[0], d.identityStrength, d.notes],
      c,
    );
    for (const a of new Set(d.assetIds)) await c.query(`INSERT INTO character_profile_assets (profile_id, asset_id) VALUES ($1,$2)`, [p!.id, a]);
    return p!.id;
  });
  return getCharacter(user, id);
}

export async function getCharacter(user: SessionUser, id: string): Promise<CharacterRow> {
  if (!z.string().uuid().safeParse(id).success) throw new AppError("not_found", "Character not found");
  const r = await one<CharacterRow>(
    `SELECT p.id, p.name, p.primary_asset_id, p.identity_strength, p.notes, p.created_at,
            COALESCE(array_agg(pa.asset_id) FILTER (WHERE pa.asset_id IS NOT NULL), '{}') AS asset_ids
       FROM character_profiles p LEFT JOIN character_profile_assets pa ON pa.profile_id=p.id
      WHERE p.id=$1 AND p.workspace_id=$2 AND p.deleted_at IS NULL GROUP BY p.id`,
    [id, user.workspaceId],
  );
  if (!r) throw new AppError("not_found", "Character not found");
  return r;
}

export async function listCharacters(user: SessionUser): Promise<CharacterRow[]> {
  return q<CharacterRow>(
    `SELECT p.id, p.name, p.primary_asset_id, p.identity_strength, p.notes, p.created_at,
            COALESCE(array_agg(pa.asset_id) FILTER (WHERE pa.asset_id IS NOT NULL), '{}') AS asset_ids
       FROM character_profiles p LEFT JOIN character_profile_assets pa ON pa.profile_id=p.id
      WHERE p.workspace_id=$1 AND p.deleted_at IS NULL GROUP BY p.id ORDER BY p.created_at DESC`,
    [user.workspaceId],
  );
}

export async function updateCharacter(user: SessionUser, id: string, input: Partial<z.input<typeof characterSchema>>) {
  await getCharacter(user, id);
  const d = characterSchema.partial().parse(input);
  if (d.assetIds) await assertCharacterAssets(user, d.assetIds);
  await tx(async (c) => {
    await c.query(
      `UPDATE character_profiles SET name=COALESCE($2,name), identity_strength=COALESCE($3,identity_strength), notes=COALESCE($4,notes) WHERE id=$1`,
      [id, d.name ?? null, d.identityStrength ?? null, d.notes ?? null],
    );
    if (d.assetIds) {
      await c.query(`DELETE FROM character_profile_assets WHERE profile_id=$1`, [id]);
      for (const a of new Set(d.assetIds)) await c.query(`INSERT INTO character_profile_assets (profile_id, asset_id) VALUES ($1,$2)`, [id, a]);
      await c.query(`UPDATE character_profiles SET primary_asset_id=$2 WHERE id=$1`, [id, d.assetIds[0]]);
    }
  });
  return getCharacter(user, id);
}

export async function deleteCharacter(user: SessionUser, id: string) {
  await getCharacter(user, id);
  await q(`UPDATE character_profiles SET deleted_at=now() WHERE id=$1`, [id]);
  return { deleted: true };
}
