import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createCharacter, deleteAsset, getAsset, listAssets, readAssetBytes, uploadAsset, getCharacter } from "@/server/assets";
import { inspect } from "@/server/images";
import { setModerationForTests } from "@/server/moderation";
import { env } from "@/server/env";
import { jpegWithExif, makeUser, pngBytes, upload } from "./helpers";

describe("private uploads", () => {
  it("strips EXIF/GPS metadata and re-encodes", async () => {
    const u = await makeUser();
    const raw = await jpegWithExif();
    expect((await inspect(raw)).hasExif).toBe(true);
    const a = await uploadAsset(u, { kind: "character", consent: "self" }, raw, "me.jpg");
    const { bytes } = await readAssetBytes(u, a.id, "original");
    const meta = await inspect(bytes);
    expect(meta.hasExif).toBe(false);
    expect(bytes.includes(Buffer.from("secret-owner"))).toBe(false);
    expect(a.mime).toBe("image/jpeg");
  });

  it("rejects non-images, spoofed extensions, tiny and oversized files", async () => {
    const u = await makeUser();
    await expect(uploadAsset(u, { kind: "product", consent: "owned_product_or_asset" }, Buffer.from("<svg onload=alert(1)>"), "x.png")).rejects.toMatchObject({ code: "unsupported_file" });
    await expect(uploadAsset(u, { kind: "product", consent: "owned_product_or_asset" }, Buffer.from("GIF89a....."), "x.jpg")).rejects.toMatchObject({ code: "unsupported_file" });
    await expect(uploadAsset(u, { kind: "product", consent: "owned_product_or_asset" }, await pngBytes(16, 16), "tiny.png")).rejects.toMatchObject({ code: "unsupported_file" });
    await expect(uploadAsset(u, { kind: "product", consent: "owned_product_or_asset" }, Buffer.alloc(env().MAX_UPLOAD_BYTES + 1), "big.png")).rejects.toMatchObject({ code: "file_too_large" });
  });

  it("requires person consent for character photos and a verified email", async () => {
    const u = await makeUser();
    await expect(uploadAsset(u, { kind: "character", consent: "no_identifiable_people" }, await pngBytes(), "c.png")).rejects.toMatchObject({ code: "consent_required" });
    const unverified = await makeUser({ verified: false });
    await expect(upload(unverified)).rejects.toMatchObject({ code: "email_not_verified" });
  });

  it("blocks images flagged by moderation and stores nothing", async () => {
    const u = await makeUser();
    setModerationForTests(async () => ({ flagged: true, categories: ["sexual"], source: "openai" }));
    try {
      await expect(upload(u)).rejects.toMatchObject({ code: "moderation_blocked" });
    } finally {
      setModerationForTests(null);
    }
    expect(await listAssets(u, {})).toHaveLength(0);
  });

  it("isolates tenants: another user cannot read, list, delete or reference my images", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const asset = await upload(a);
    await expect(getAsset(b, asset.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(readAssetBytes(b, asset.id, "original")).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteAsset(b, asset.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await listAssets(b, {})).map((x) => x.id)).not.toContain(asset.id);
    await expect(createCharacter(b, { name: "steal", assetIds: [asset.id] })).rejects.toMatchObject({ code: "not_found" });
  });

  it("deleting an asset removes the stored objects and detaches it from characters", async () => {
    const u = await makeUser();
    const a = await upload(u);
    const ch = await createCharacter(u, { name: "Me", assetIds: [a.id] });
    const file = path.resolve(process.cwd(), env().STORAGE_LOCAL_DIR, a.storage_key);
    expect(fs.existsSync(file)).toBe(true);
    await deleteAsset(u, a.id);
    expect(fs.existsSync(file)).toBe(false);
    await expect(getAsset(u, a.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await getCharacter(u, ch.id)).asset_ids).toEqual([]);
  });

  it("character profiles only accept character-kind photos", async () => {
    const u = await makeUser();
    const product = await upload(u, "product");
    await expect(createCharacter(u, { name: "x", assetIds: [product.id] })).rejects.toMatchObject({ code: "validation_failed" });
  });
});
