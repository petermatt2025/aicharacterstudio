import "server-only";
import JSZip from "jszip";
import { z } from "zod";
import type { SessionUser } from "./accounts";
import { one, q, tx } from "./db";
import { AppError } from "./errors";
import { readAssetBytes } from "./assets";
import { EXT } from "./images";

/** Campaign folders: a name + brief and a set of the workspace's own images. */
export const MAX_CAMPAIGNS = 100;
export const MAX_CAMPAIGN_ITEMS = 500;

export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(80),
  brief: z.string().trim().max(2000).default(""),
});

export type Campaign = { id: string; name: string; brief: string; updated_at: Date; item_count: number; cover_ids: string[] };

const LIVE_ITEMS = `campaign_items i JOIN assets a ON a.id=i.asset_id AND a.deleted_at IS NULL`;

export async function listCampaigns(user: SessionUser): Promise<Campaign[]> {
  return q<Campaign>(
    `SELECT c.id, c.name, c.brief, c.updated_at,
            (SELECT count(*)::int FROM ${LIVE_ITEMS} WHERE i.campaign_id=c.id) AS item_count,
            COALESCE((SELECT array_agg(x.asset_id) FROM (SELECT i.asset_id FROM ${LIVE_ITEMS} WHERE i.campaign_id=c.id ORDER BY i.added_at DESC LIMIT 4) x), '{}') AS cover_ids
       FROM campaigns c WHERE c.workspace_id=$1 AND c.deleted_at IS NULL ORDER BY c.updated_at DESC`,
    [user.workspaceId],
  );
}

export async function getCampaign(user: SessionUser, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new AppError("not_found", "Campaign not found");
  const c = await one<{ id: string; name: string; brief: string; updated_at: Date }>(
    `SELECT id, name, brief, updated_at FROM campaigns WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`,
    [id, user.workspaceId],
  );
  if (!c) throw new AppError("not_found", "Campaign not found");
  const items = await q<{ asset_id: string }>(`SELECT i.asset_id FROM ${LIVE_ITEMS} WHERE i.campaign_id=$1 ORDER BY i.added_at DESC`, [id]);
  return { ...c, asset_ids: items.map((r) => r.asset_id) };
}

export async function createCampaign(user: SessionUser, input: z.input<typeof campaignSchema>) {
  const d = campaignSchema.parse(input);
  const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM campaigns WHERE workspace_id=$1 AND deleted_at IS NULL`, [user.workspaceId]);
  if (n!.n >= MAX_CAMPAIGNS) throw new AppError("validation_failed", `You can have up to ${MAX_CAMPAIGNS} campaigns.`);
  const c = await one<{ id: string }>(`INSERT INTO campaigns (workspace_id, owner_user_id, name, brief) VALUES ($1,$2,$3,$4) RETURNING id`, [user.workspaceId, user.id, d.name, d.brief]);
  return getCampaign(user, c!.id);
}

export async function updateCampaign(user: SessionUser, id: string, input: Partial<z.input<typeof campaignSchema>>) {
  await getCampaign(user, id);
  const d = campaignSchema.partial().parse(input);
  await q(`UPDATE campaigns SET name=COALESCE($2,name), brief=COALESCE($3,brief), updated_at=now() WHERE id=$1`, [id, d.name ?? null, d.brief ?? null]);
  return getCampaign(user, id);
}

export async function deleteCampaign(user: SessionUser, id: string) {
  await getCampaign(user, id);
  await q(`UPDATE campaigns SET deleted_at=now() WHERE id=$1`, [id]);
  return { deleted: true };
}

const idsSchema = z.array(z.string().uuid()).min(1).max(200);

/** Add images (own, live assets only) to a campaign. Idempotent. */
export async function addToCampaign(user: SessionUser, id: string, assetIds: string[]) {
  const ids = [...new Set(idsSchema.parse(assetIds))];
  await getCampaign(user, id);
  const owned = await q<{ id: string }>(`SELECT id FROM assets WHERE id = ANY($1) AND workspace_id=$2 AND deleted_at IS NULL`, [ids, user.workspaceId]);
  if (owned.length !== ids.length) throw new AppError("not_found", "One or more images were not found.");
  await tx(async (c) => {
    const count = await one<{ n: number }>(`SELECT count(*)::int AS n FROM campaign_items WHERE campaign_id=$1`, [id], c);
    if (count!.n + ids.length > MAX_CAMPAIGN_ITEMS) throw new AppError("validation_failed", `A campaign holds up to ${MAX_CAMPAIGN_ITEMS} images.`);
    for (const a of ids) await c.query(`INSERT INTO campaign_items (campaign_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, a]);
    await c.query(`UPDATE campaigns SET updated_at=now() WHERE id=$1`, [id]);
  });
  return getCampaign(user, id);
}

export async function removeFromCampaign(user: SessionUser, id: string, assetIds: string[]) {
  const ids = idsSchema.parse(assetIds);
  await getCampaign(user, id);
  await q(`DELETE FROM campaign_items WHERE campaign_id=$1 AND asset_id = ANY($2)`, [id, ids]);
  await q(`UPDATE campaigns SET updated_at=now() WHERE id=$1`, [id]);
  return getCampaign(user, id);
}

/** Worker hook: file a generated image into the job's campaign (if it still exists in that workspace). */
export async function fileOutputInCampaign(workspaceId: string, campaignId: string, assetId: string) {
  await q(
    `INSERT INTO campaign_items (campaign_id, asset_id)
     SELECT c.id, $3 FROM campaigns c WHERE c.id=$1 AND c.workspace_id=$2 AND c.deleted_at IS NULL
     ON CONFLICT DO NOTHING`,
    [campaignId, workspaceId, assetId],
  );
  await q(`UPDATE campaigns SET updated_at=now() WHERE id=$1 AND workspace_id=$2`, [campaignId, workspaceId]);
}

export async function campaignZip(user: SessionUser, id: string) {
  const c = await getCampaign(user, id);
  if (!c.asset_ids.length) throw new AppError("not_found", "This campaign has no images yet.");
  const zip = new JSZip();
  let n = 0;
  for (const a of c.asset_ids.slice(0, 300)) {
    const { bytes, mime } = await readAssetBytes(user, a, "original");
    zip.file(`${String(++n).padStart(3, "0")}.${EXT[mime as keyof typeof EXT]}`, bytes);
  }
  zip.file("BRIEF.txt", `${c.name}\n\n${c.brief || "(no brief)"}\n\nAI-generated (synthetic) images. Likeness, products and text may be inaccurate. Review before commercial use.\n`);
  const buf = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  const safe = c.name.replace(/[^\w-]+/g, "_").slice(0, 40) || "campaign";
  return { buf, filename: `${safe}.zip` };
}
