"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fileUrl } from "@/lib/api";
import { Uploader, type AssetLite } from "./uploader";
import { Button, Card, Field, Notice, cx, inputCls } from "./ui";

type Board = { id: string; name: string; description: string; assetIds: string[] };
type ApiBoard = { id: string; name: string; description: string; asset_ids: string[] };
const toBoard = (b: ApiBoard): Board => ({ id: b.id, name: b.name, description: b.description, assetIds: b.asset_ids });
const MAX = 12;

export function Mosaic({ ids, className }: { ids: string[]; className?: string }) {
  const four = ids.slice(0, 4);
  return (
    <div className={cx("grid aspect-[2/1] grid-cols-4 gap-0.5 overflow-hidden rounded-xl bg-bg", className)}>
      {four.length ? four.map((id) => <img key={id} src={fileUrl(id, { thumb: true })} alt="" className="h-full w-full object-cover" />) : <span className="col-span-4 grid place-items-center text-xs text-muted">Add an image to get started</span>}
    </div>
  );
}

export function StyleBoards({ initialBoards, initialAssets }: { initialBoards: Board[]; initialAssets: AssetLite[] }) {
  const [boards, setBoards] = useState(initialBoards);
  const [assets, setAssets] = useState(initialAssets);
  // The board being edited. Nothing is stored until "Save style" (id null = new, not yet saved).
  const [draft, setDraft] = useState<(Omit<Board, "id"> & { id: string | null }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "describe" | "delete" | null>(null);

  const saved = draft?.id ? boards.find((b) => b.id === draft.id) ?? null : null;
  const dirty = !!draft && (!saved || saved.name !== draft.name || saved.description !== draft.description || saved.assetIds.join() !== draft.assetIds.join());

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function open(b: Board | null) {
    setDraft(b ? { ...b } : { id: null, name: `Style board #${boards.length + 1}`, description: "", assetIds: [] });
    setError(null);
    setNotice(null);
  }
  function close() {
    if (dirty && !confirm("You have unsaved changes. Leave without saving?")) return;
    setDraft(null);
  }
  function toggleImage(id: string) {
    setDraft((d) => {
      if (!d) return d;
      if (d.assetIds.includes(id)) return { ...d, assetIds: d.assetIds.filter((x) => x !== id) };
      if (d.assetIds.length >= MAX) {
        setError(`A board holds up to ${MAX} images.`);
        return d;
      }
      return { ...d, assetIds: [...d.assetIds, id] };
    });
    setNotice(null);
  }

  /** Saves the whole draft (name, images, description). Returns the saved board. */
  async function save(): Promise<Board | null> {
    if (!draft) return null;
    if (!draft.name.trim()) {
      setError("Give the style a name.");
      return null;
    }
    setBusy("save");
    setError(null);
    try {
      const body = { name: draft.name.trim(), description: draft.description, assetIds: draft.assetIds };
      const r = draft.id
        ? await api<{ board: ApiBoard }>(`/api/style-boards/${draft.id}`, { method: "PATCH", body })
        : await api<{ board: ApiBoard }>("/api/style-boards", { body });
      const b = toBoard(r.board);
      setBoards((xs) => (xs.some((x) => x.id === b.id) ? xs.map((x) => (x.id === b.id ? b : x)) : [b, ...xs]));
      setDraft({ ...b });
      setNotice("Style saved ✓");
      return b;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function describe() {
    if (!draft) return;
    const b = dirty || !draft.id ? await save() : ({ ...draft, id: draft.id } as Board);
    if (!b) return;
    setBusy("describe");
    setError(null);
    try {
      const r = await api<{ description: string }>(`/api/style-boards/${b.id}/describe`, { method: "POST" });
      const updated = { ...b, description: r.description };
      setBoards((xs) => xs.map((x) => (x.id === b.id ? updated : x)));
      setDraft({ ...updated });
      setNotice("Description written and saved ✓");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!draft) return;
    if (!draft.id) return setDraft(null);
    if (!confirm(`Delete "${draft.name}"? Images stay in your gallery.`)) return;
    setBusy("delete");
    try {
      await api(`/api/style-boards/${draft.id}`, { method: "DELETE" });
      setBoards((xs) => xs.filter((x) => x.id !== draft.id));
      setDraft(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!draft) {
    return (
      <div className="space-y-6">
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end"><Button onClick={() => open(null)}>＋ New style board</Button></div>
        {boards.length === 0 ? (
          <Card className="text-sm text-muted">No style boards yet. Create one, add a few images that share a look, click <b>Save style</b>, then pick it in any tool under “Style board”.</Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => open(b)} className="block w-full text-left">
                  <Mosaic ids={b.assetIds} />
                  <span className="mt-2 block font-medium">{b.name}</span>
                  <span className="text-xs text-muted">{b.assetIds.length} image{b.assetIds.length === 1 ? "" : "s"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const saveBar = (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => void save()} disabled={!!busy || !dirty}>{busy === "save" ? "Saving…" : "💾 Save style"}</Button>
      {dirty ? <span className="text-sm text-accent">Unsaved changes</span> : notice ? <span className="text-sm text-muted">{notice}</span> : draft.id ? <span className="text-sm text-muted">All changes saved</span> : null}
    </div>
  );

  return (
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="text-sm text-muted hover:text-ink" onClick={close}>← All style boards</button>
        {saveBar}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Images in this style</h2>
            <span className="text-xs text-muted">{draft.assetIds.length}/{MAX} images</span>
          </div>
          {draft.assetIds.length ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {draft.assetIds.map((id) => (
                <li key={id} className="relative">
                  <img src={fileUrl(id, { thumb: true })} alt="" className="aspect-square w-full rounded-lg object-cover" />
                  <button type="button" aria-label="Remove from board" onClick={() => toggleImage(id)} className="absolute right-1 top-1 rounded-full bg-black/70 px-2 text-sm text-white">×</button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Tap images below or upload new ones. 3–9 images that share colors, lighting and mood work best.</p>}
          <h3 className="pt-2 text-sm font-medium">Add from your gallery</h3>
          {assets.length ? (
            <ul className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
              {assets.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => toggleImage(a.id)} aria-pressed={draft.assetIds.includes(a.id)} className={cx("block aspect-square w-full overflow-hidden rounded-lg border-2", draft.assetIds.includes(a.id) ? "border-accent" : "border-transparent")}>
                    <img src={fileUrl(a.id, { thumb: true })} alt={a.title} className="h-full w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">No images yet. Upload one below.</p>}
          <Uploader kind="style" compact onUploaded={(a) => { setAssets((xs) => [a, ...xs]); toggleImage(a.id); }} />
          <p className="text-xs text-muted">Uploaded images are added to the board. Click <b>Save style</b> to keep them.</p>
        </Card>
        <Card className="space-y-4">
          <Field label="Name" htmlFor="bname">
            <input id="bname" className={inputCls} maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Style description" htmlFor="bdesc" hint="Sent with every image that uses this style. Write it yourself or let Gemini describe the images.">
            <textarea id="bdesc" rows={5} maxLength={1000} className={inputCls} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void describe()} disabled={!!busy || !draft.assetIds.length}>{busy === "describe" ? "Describing…" : "✨ Describe this style"}</Button>
            <Button variant="ghost" onClick={() => void remove()} disabled={!!busy}>{draft.id ? "Delete board" : "Discard"}</Button>
          </div>
          {saveBar}
          {draft.id && !dirty && (
            <div className="rounded-xl border border-line p-3 text-sm">
              <p className="font-medium">Use this style</p>
              <p className="mt-1 text-muted">In any tool, choose <b>{draft.name}</b> under “Style board”. To restyle an existing image, use <b>🎨 Restyle</b> in the Gallery.</p>
              <div className="mt-2 flex flex-wrap gap-3">
                <Link className="text-accent hover:underline" href={`/studio/environment_switch?style=${draft.id}`}>Environment →</Link>
                <Link className="text-accent hover:underline" href={`/studio/photoshoot?style=${draft.id}`}>Photoshoot →</Link>
                <Link className="text-accent hover:underline" href={`/studio/style_transform?style=${draft.id}`}>Style Transformer →</Link>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
