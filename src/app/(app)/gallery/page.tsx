"use client";
import { useCallback, useEffect, useState } from "react";
import { api, fileUrl } from "@/lib/api";
import type { AssetLite } from "@/components/uploader";
import { Button, Card, Notice, PageHeader, cx, inputCls } from "@/components/ui";
import { TOOLS } from "@/lib/tools";

const EDIT_ACTIONS: Array<[string, string]> = [
  ["magic_edit", "✏️ Edit"],
  ["enhance", "Enhance"],
  ["upscale", "Upscale"],
  ["expand_wide", "Expand"],
  ["remove_bg", "Remove BG"],
  ["variation", "Variation"],
  ["apply_style", "🎨 Restyle"],
];

export default function Gallery() {
  const [items, setItems] = useState<AssetLite[]>([]);
  const [feature, setFeature] = useState("");
  const [search, setSearch] = useState("");
  const [fav, setFav] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => { api<{ campaigns: Array<{ id: string; name: string }> }>("/api/campaigns").then((r) => setCampaigns(r.campaigns)).catch(() => {}); }, []);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ kind: "output", limit: "100" });
    if (feature) p.set("featureKey", feature);
    if (search) p.set("search", search);
    if (fav) p.set("favorite", "true");
    const r = await api<{ assets: AssetLite[] }>(`/api/assets?${p}`);
    setItems(r.assets);
  }, [feature, search, fav]);
  useEffect(() => { const t = setTimeout(() => load().catch((e) => setError((e as Error).message)), 250); return () => clearTimeout(t); }, [load]);

  async function toggleFav(a: AssetLite) {
    await api(`/api/assets/${a.id}`, { method: "PATCH", body: { favorite: !a.favorite } });
    load();
  }
  async function addToCampaign(id: string) {
    if (!id || !selected.length) return;
    setError(null);
    try {
      await api(`/api/campaigns/${id}/items`, { body: { assetIds: selected } });
      setNotice(`Added ${selected.length} image(s) to "${campaigns.find((c) => c.id === id)?.name}".`);
      setSelected([]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function bulkDelete() {
    if (!selected.length || !confirm(`Delete ${selected.length} image(s) permanently?`)) return;
    for (const id of selected) await api(`/api/assets/${id}`, { method: "DELETE" }).catch((e) => setError((e as Error).message));
    setSelected([]);
    load();
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Gallery" sub="Everything you've generated. Private to your account." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="mb-1 block text-muted">Tool</span>
          <select className={inputCls} value={feature} onChange={(e) => setFeature(e.target.value)}>
            <option value="">All tools</option>
            {Object.values(TOOLS).map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="mb-1 block text-muted">Search</span><input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title…" /></label>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={fav} onChange={(e) => setFav(e.target.checked)} />Favorites</label>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => setView(view === "grid" ? "list" : "grid")}>{view === "grid" ? "List view" : "Grid view"}</Button>
          {campaigns.length > 0 && (
            <select aria-label="Add selected to campaign" className={inputCls + " w-auto"} disabled={!selected.length} value="" onChange={(e) => void addToCampaign(e.target.value)}>
              <option value="">Add selected to campaign…</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <Button variant="danger" disabled={!selected.length} onClick={bulkDelete}>Delete selected ({selected.length})</Button>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}
      {items.length === 0 ? <Card className="text-sm text-muted">No images match.</Card> : (
        <ul className={cx(view === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" : "space-y-2")}>
          {items.map((a) => (
            <li key={a.id} className={cx("overflow-hidden rounded-xl border bg-surface", selected.includes(a.id) ? "border-accent" : "border-line", view === "list" && "flex items-center gap-3 p-2")}>
              {a.mime?.startsWith("video/") && view === "grid" ? (
                <video src={fileUrl(a.id)} poster={fileUrl(a.id, { thumb: true })} controls playsInline preload="none" className="aspect-square w-full bg-black object-cover" />
              ) : (
                <a href={fileUrl(a.id)} target="_blank" rel="noreferrer" className={cx("relative block", view === "list" && "shrink-0")}>
                  <img src={fileUrl(a.id, { thumb: true })} alt={a.title} className={view === "grid" ? "aspect-square w-full object-cover" : "h-16 w-16 rounded-lg object-cover"} />
                  {a.mime?.startsWith("video/") && <span className="absolute inset-0 grid place-items-center text-white">▶</span>}
                </a>
              )}
              <div className={cx("flex flex-wrap items-center justify-between gap-2 p-2 text-xs", view === "list" && "flex-1")}>
                <label className="flex items-center gap-1"><input type="checkbox" checked={selected.includes(a.id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id))} /><span className="sr-only">Select {a.title}</span></label>
                <span className="truncate text-muted">{TOOLS[a.featureKey ?? ""]?.title ?? a.title} · {a.width}×{a.height}{a.watermarked ? " · watermarked" : ""}</span>
                <span className="flex gap-2">
                  <button onClick={() => toggleFav(a)} aria-pressed={!!a.favorite} aria-label="Favorite" className={a.favorite ? "text-accent" : "text-muted"}>★</button>
                  <a href={fileUrl(a.id, { download: true })} className="text-muted hover:text-ink">Download</a>
                </span>
                {!a.mime?.startsWith("video/") && <div className="flex w-full flex-wrap gap-1" aria-label="Edit this image">
                  <a href={`/studio/animate?source=${a.id}`} className="rounded-full border border-accent/60 px-2 py-0.5 text-accent hover:bg-accent/10">🎬 Animate</a>
                  {EDIT_ACTIONS.map(([preset, label]) => (
                    <a key={preset} href={`/studio/image_edit?source=${a.id}&preset=${preset}`} className="rounded-full border border-line px-2 py-0.5 text-muted hover:border-accent hover:text-ink">{label}</a>
                  ))}
                  <a href={`/text/${a.id}`} className="rounded-full border border-line px-2 py-0.5 text-muted hover:border-accent hover:text-ink">Aa Add text</a>
                  <a href={`/studio/image_to_prompt?source=${a.id}`} className="rounded-full border border-line px-2 py-0.5 text-muted hover:border-accent hover:text-ink">Get prompt</a>
                </div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
