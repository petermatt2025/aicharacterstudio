"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, fileUrl } from "@/lib/api";
import type { AssetLite } from "./uploader";
import { Mosaic } from "./style-boards";
import { Button, Card, Field, Notice, cx, inputCls } from "./ui";

type Row = { id: string; name: string; brief: string; count: number; covers: string[] };
type ApiCampaign = { id: string; name: string; brief: string; asset_ids: string[] };

const QUICK_TOOLS: Array<[string, string]> = [
  ["batch_campaigns", "Batch Campaign"],
  ["photoshoot", "Photoshoot"],
  ["influencer_campaigns", "Influencer Campaign"],
  ["social_content", "Social Content"],
  ["ugc_ads", "UGC Ads"],
  ["product_lifestyle", "Product Lifestyle"],
];

export function CampaignList({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ campaign: ApiCampaign }>("/api/campaigns", { body: { name: name.trim() || `Campaign ${initial.length + 1}` } });
      router.push(`/campaigns/${r.campaign.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      {error && <Notice tone="error">{error}</Notice>}
      <Card className="flex flex-wrap items-end gap-3">
        <Field label="New campaign" htmlFor="cname">
          <input id="cname" className={inputCls + " w-72"} maxLength={80} placeholder="e.g. Summer launch, Client: Bloom Café" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
        </Field>
        <Button onClick={() => void create()} disabled={busy}>＋ Create campaign</Button>
      </Card>
      {initial.length === 0 ? (
        <Card className="text-sm text-muted">No campaigns yet. Create one, then pick it under “Save to campaign” in any tool, or add images from your Gallery.</Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {initial.map((c) => (
            <li key={c.id}>
              <Link href={`/campaigns/${c.id}`} className="block">
                <Mosaic ids={c.covers} />
                <span className="mt-2 block font-medium">{c.name}</span>
                <span className="text-xs text-muted">{c.count} image{c.count === 1 ? "" : "s"}{c.brief ? ` · ${c.brief.slice(0, 60)}${c.brief.length > 60 ? "…" : ""}` : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CampaignDetail({ campaign, library }: { campaign: { id: string; name: string; brief: string; assetIds: string[] }; library: AssetLite[] }) {
  const router = useRouter();
  const [c, setC] = useState(campaign);
  const [draft, setDraft] = useState({ name: campaign.name, brief: campaign.brief });
  const [selected, setSelected] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const dirty = draft.name !== c.name || draft.brief !== c.brief;

  async function run(fn: () => Promise<ApiCampaign | null>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r) {
        setC({ id: r.id, name: r.name, brief: r.brief, assetIds: r.asset_ids });
        setDraft({ name: r.name, brief: r.brief });
      }
      if (ok) setMsg({ tone: "ok", text: ok });
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const save = () => run(async () => (await api<{ campaign: ApiCampaign }>(`/api/campaigns/${c.id}`, { method: "PATCH", body: draft })).campaign, "Saved ✓");
  const add = () => run(async () => {
    const r = (await api<{ campaign: ApiCampaign }>(`/api/campaigns/${c.id}/items`, { body: { assetIds: pick } })).campaign;
    setPick([]);
    setPicking(false);
    return r;
  }, "Images added ✓");
  const remove = () => run(async () => {
    const r = (await api<{ campaign: ApiCampaign }>(`/api/campaigns/${c.id}/items`, { method: "DELETE", body: { assetIds: selected } })).campaign;
    setSelected([]);
    return r;
  }, "Removed from campaign (still in your gallery)");
  async function del() {
    if (!confirm(`Delete the campaign "${c.name}"? The images stay in your gallery.`)) return;
    await run(async () => { await api(`/api/campaigns/${c.id}`, { method: "DELETE" }); router.push("/campaigns"); return null; });
  }
  const notIn = library.filter((a) => !c.assetIds.includes(a.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/campaigns" className="text-sm text-muted hover:text-ink">← All campaigns</Link>
        <div className="flex flex-wrap gap-2">
          {c.assetIds.length > 0 && <a href={`/api/campaigns/${c.id}/zip`} className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2">⬇ Download ZIP ({c.assetIds.length})</a>}
          <Button variant="ghost" onClick={() => void del()} disabled={busy}>Delete campaign</Button>
        </div>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Images ({c.assetIds.length})</h2>
              <div className="flex gap-2">
                {selected.length > 0 && <Button variant="secondary" onClick={() => void remove()} disabled={busy}>Remove selected ({selected.length})</Button>}
                <Button variant="secondary" onClick={() => setPicking(!picking)}>{picking ? "Close" : "＋ Add from gallery"}</Button>
              </div>
            </div>
            {picking && (
              <div className="space-y-3 rounded-xl border border-line bg-bg p-3">
                {notIn.length ? (
                  <ul className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                    {notIn.map((a) => (
                      <li key={a.id}>
                        <button type="button" aria-pressed={pick.includes(a.id)} onClick={() => setPick((p) => (p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id]))}
                          className={cx("block aspect-square w-full overflow-hidden rounded-lg border-2", pick.includes(a.id) ? "border-accent" : "border-transparent")}>
                          <img src={fileUrl(a.id, { thumb: true })} alt={a.title} className="h-full w-full object-cover" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">All your generated images are already in this campaign.</p>}
                <Button onClick={() => void add()} disabled={busy || !pick.length}>Add {pick.length || ""} image{pick.length === 1 ? "" : "s"}</Button>
              </div>
            )}
            {c.assetIds.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {c.assetIds.map((id) => (
                  <li key={id} className={cx("overflow-hidden rounded-xl border bg-surface", selected.includes(id) ? "border-accent" : "border-line")}>
                    <a href={fileUrl(id)} target="_blank" rel="noreferrer"><img src={fileUrl(id, { thumb: true })} alt="" className="aspect-square w-full object-cover" /></a>
                    <div className="flex items-center justify-between gap-2 p-2 text-xs">
                      <label className="flex items-center gap-1"><input type="checkbox" checked={selected.includes(id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, id] : s.filter((x) => x !== id)))} /><span className="sr-only">Select</span></label>
                      <span className="flex gap-2">
                        <a href={`/text/${id}`} className="text-muted hover:text-ink">Aa Text</a>
                        <a href={fileUrl(id, { download: true })} className="text-muted hover:text-ink">Download</a>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No images yet. Add some from your gallery, or create new ones with a tool on the right.</p>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="space-y-3">
            <Field label="Campaign name" htmlFor="c-name">
              <input id="c-name" className={inputCls} maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Brief" htmlFor="c-brief" hint="Goal, audience, colours, key messages. Copied into each tool's prompt when you create from here.">
              <textarea id="c-brief" rows={6} maxLength={2000} className={inputCls} value={draft.brief} onChange={(e) => setDraft({ ...draft, brief: e.target.value })} />
            </Field>
            <div className="flex items-center gap-3">
              <Button onClick={() => void save()} disabled={busy || !dirty || !draft.name.trim()}>💾 Save</Button>
              {dirty && <span className="text-sm text-accent">Unsaved changes</span>}
            </div>
          </Card>
          <Card className="space-y-2">
            <h2 className="font-semibold">Create in this campaign</h2>
            <p className="text-sm text-muted">New images are filed here automatically.</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_TOOLS.map(([key, label]) => (
                <Link key={key} href={`/studio/${key}?campaign=${c.id}${c.brief ? `&prompt=${encodeURIComponent(c.brief.slice(0, 1500))}` : ""}`} className="rounded-full border border-line px-3 py-1 text-sm hover:border-accent">{label} →</Link>
              ))}
            </div>
            <p className="text-xs text-muted">Or pick this campaign under “Save to campaign” in any tool.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
