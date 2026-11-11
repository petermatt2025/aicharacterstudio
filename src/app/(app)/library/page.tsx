"use client";
import { useCallback, useEffect, useState } from "react";
import { api, fileUrl } from "@/lib/api";
import { Uploader, type AssetLite } from "@/components/uploader";
import { Badge, Button, Card, Field, Notice, PageHeader, cx, inputCls } from "@/components/ui";
import type { UploadKind } from "@/lib/consent";

type Character = { id: string; name: string; primary_asset_id: string | null; identity_strength: string; asset_ids: string[]; notes: string };
const TABS: Array<{ key: string; label: string; kind?: UploadKind | "output" }> = [
  { key: "characters", label: "Characters", kind: "character" },
  { key: "products", label: "Products", kind: "product" },
  { key: "outfits", label: "Outfits", kind: "outfit" },
  { key: "backgrounds", label: "Backgrounds", kind: "background" },
  { key: "generated", label: "Generated", kind: "output" },
  { key: "brand", label: "Brand kits" },
];

export default function Library() {
  const [tab, setTab] = useState(TABS[0]!);
  const [assets, setAssets] = useState<AssetLite[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [strength, setStrength] = useState("balanced");
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!tab.kind) return;
    let alive = true;
    (async () => {
      try {
        const [a, c] = await Promise.all([api<{ assets: AssetLite[] }>(`/api/assets?kind=${tab.kind}&limit=100`), api<{ characters: Character[] }>("/api/characters")]);
        if (!alive) return;
        setAssets(a.assets);
        setCharacters(c.characters);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => { alive = false; };
  }, [tab, version]);

  async function remove(id: string) {
    if (!confirm("Delete this image permanently? It will also be removed from any character profile.")) return;
    await api(`/api/assets/${id}`, { method: "DELETE" }).catch((e) => setError((e as Error).message));
    setSelected((s) => s.filter((x) => x !== id));
    load();
  }
  async function createCharacter() {
    setError(null);
    try {
      await api("/api/characters", { body: { name, assetIds: selected, identityStrength: strength } });
      setName(""); setSelected([]); load();
    } catch (e) { setError((e as Error).message); }
  }
  async function deleteCharacter(id: string) {
    if (!confirm("Delete this character profile? Its photos stay in your library.")) return;
    await api(`/api/characters/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Library" sub="Your private references. Only you can see them." />
      <div role="tablist" aria-label="Library sections" className="mb-6 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab.key === t.key} onClick={() => { setTab(t); setSelected([]); }} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", tab.key === t.key ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>{t.label}</button>
        ))}
      </div>
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
      {!tab.kind ? (
        <Card className="space-y-2"><Badge tone="planned" /><p className="text-sm text-muted">Brand kits (logos, colors, fonts) arrive with the phase 3 marketing release.</p></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            {tab.key === "characters" && characters.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 font-semibold">Character profiles</h2>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {characters.map((c) => (
                    <li key={c.id}><Card className="flex items-center gap-3 p-3">
                      {c.primary_asset_id ? <img src={fileUrl(c.primary_asset_id, { thumb: true })} alt="" className="h-14 w-14 rounded-lg object-cover" /> : <div className="h-14 w-14 rounded-lg bg-surface-2" />}
                      <div className="min-w-0 flex-1"><p className="truncate font-medium">{c.name}</p><p className="text-xs text-muted">{c.asset_ids.length} photo(s) · {c.identity_strength}</p></div>
                      <Button variant="ghost" onClick={() => deleteCharacter(c.id)} aria-label={`Delete ${c.name}`}>Delete</Button>
                    </Card></li>
                  ))}
                </ul>
              </section>
            )}
            {assets.length === 0 ? <Card className="text-sm text-muted">Nothing here yet.</Card> : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {assets.map((a) => (
                  <li key={a.id} className={cx("overflow-hidden rounded-xl border bg-surface", selected.includes(a.id) ? "border-accent" : "border-line")}>
                    <img src={fileUrl(a.id, { thumb: true })} alt={a.title} className="aspect-square w-full object-cover" />
                    <div className="flex items-center justify-between gap-1 p-2 text-xs">
                      {tab.key === "characters" ? (
                        <label className="flex items-center gap-1"><input type="checkbox" checked={selected.includes(a.id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id))} />Select</label>
                      ) : <a href={fileUrl(a.id, { download: true })} className="text-muted hover:text-ink">Download</a>}
                      <button onClick={() => remove(a.id)} className="text-bad">Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-4">
            {tab.kind !== "output" && <Uploader kind={tab.kind} onUploaded={() => load()} />}
            {tab.key === "characters" && (
              <Card className="space-y-3">
                <h2 className="font-semibold">New character profile</h2>
                <p className="text-xs text-muted">Select 1–8 photos of the same person. More angles usually improve consistency.</p>
                <Field label="Name" htmlFor="cn"><input id="cn" className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Identity Lock default" htmlFor="cs"><select id="cs" className={inputCls} value={strength} onChange={(e) => setStrength(e.target.value)}><option value="loose">Loose</option><option value="balanced">Balanced</option><option value="strict">Strict</option></select></Field>
                <Button disabled={!name.trim() || selected.length === 0} onClick={createCharacter}>Save character ({selected.length})</Button>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
