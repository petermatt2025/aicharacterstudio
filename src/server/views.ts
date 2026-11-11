import "server-only";
import type { AssetRow } from "./assets";

export function assetView(a: AssetRow) {
  return { id: a.id, kind: a.kind, title: a.title, mime: a.mime, width: a.width, height: a.height, bytes: a.bytes, featureKey: a.feature_key, favorite: a.favorite, watermarked: a.watermarked, createdAt: a.created_at };
}
