"use client";
import Link from "next/link";
import { useState } from "react";
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const board = boards.find((b) => b.id === openId) ?? null;
  const [draft, setDraft] = useState<{ name: string; description: string }>({ name: "", description: "" });

  function open(b: Board) {
    setOpenId(b.id);
    setDraft({ name: b.name, description: b.description });
    setError(null);
  }
  async function run<T>(label: string, fn: () => Promise<T>) {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const replace = (b: Board) => setBoards((xs) => xs.map((x) => (x.id === b.id ? b : x)));

  async function create() {
    const r = await run("create", () => api<{ board: ApiBoard }>("/api/style-boards", { body: { name: `Style board #${boards.length + 1}` } }));
    if (r) {
      const b = toBoard(r.board);
      setBoards((xs) => [b, ...xs]);
      open(b);
    }
  }
  async function save(patch: Partial<{ name: string; description: string; assetIds: string[] }>) {
    if (!board) return;
    const r = await run("save", () => api<{ board: ApiBoard }>(`/api/style-boards/${board.id}`, { method: "PATCH", body: patch }));
    if (r) replace(toBoard(r.board));
  }
  function toggleImage(id: string) {
    if (!board) return;
    const has = board.assetIds.includes(id);
    if (!has && board.assetIds.length >= MAX) return setError(`A board holds up to ${MAX} images.`);
    void save({ assetIds: has ? board.assetIds.filter((x) => x !== id) : [...board.assetIds, id] });
  }
  async function describe() {
    if (!board) return;
    const r = await run("describe", () => api<{ description: string }>(`/api/style-boards/${board.id}/describe`, { method: "POST" }));
    if (r) {
      setDraft((d) => ({ ...d, description: r.description }));
      replace({ ...board, description: r.description });
    }
  }
  async function remove() {
    if (!board || !confirm(`Delete "${board.name}"? Images stay in your gallery.`)) return;
    const r = await run("delete", () => api(`/api/style-boards/${board.id}`, { method: "DELETE" }));
    if (r) {
      setBoards((xs) => xs.filter((x) => x.id !== board.id));
      setOpenId(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Notice tone="error">{error}</Notice>}
      {!board ? (
        <>
          <div className="flex justify-end"><Button onClick={create} disabled={!!busy}>＋ New style board</Button></div>
          {boards.length === 0 ? (
            <Card className="text-sm text-muted">No style boards yet. Create one, add a few images that share a look, then pick it in any tool under “Style board”.</Card>
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
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => setOpenId(null)}>← All style boards</button>
              <span className="text-xs text-muted">{board.assetIds.length}/{MAX} images</span>
            </div>
            <h2 className="font-semibold">Images in this board</h2>
            {board.assetIds.length ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {board.assetIds.map((id) => (
                  <li key={id} className="relative">
                    <img src={fileUrl(id, { thumb: true })} alt="" className="aspect-square w-full rounded-lg object-cover" />
                    <button type="button" aria-label="Remove from board" onClick={() => toggleImage(id)} className="absolute right-1 top-1 rounded-full bg-black/70 px-2 text-sm text-white">×</button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Pick images below. 3–9 images that share colors, lighting and mood work best.</p>}
            <h3 className="pt-2 text-sm font-medium">Add from your gallery</h3>
            <ul className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
              {assets.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => toggleImage(a.id)} aria-pressed={board.assetIds.includes(a.id)} className={cx("block aspect-square w-full overflow-hidden rounded-lg border-2", board.assetIds.includes(a.id) ? "border-accent" : "border-transparent")}>
                    <img src={fileUrl(a.id, { thumb: true })} alt={a.title} className="h-full w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
            <Uploader kind="style" compact onUploaded={(a) => { setAssets((xs) => [a, ...xs]); toggleImage(a.id); }} />
          </Card>
          <Card className="space-y-4">
            <Field label="Name" htmlFor="bname">
              <input id="bname" className={inputCls} maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => draft.name.trim() && draft.name !== board.name && save({ name: draft.name })} />
            </Field>
            <Field label="Style description" htmlFor="bdesc" hint="Sent with every image that uses this board. Write it yourself or let Gemini describe the images.">
              <textarea id="bdesc" rows={5} maxLength={1000} className={inputCls} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} onBlur={() => draft.description !== board.description && save({ description: draft.description })} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={describe} disabled={!!busy || !board.assetIds.length}>{busy === "describe" ? "Describing…" : "✨ Describe this style"}</Button>
              <Button variant="ghost" onClick={remove} disabled={!!busy}>Delete board</Button>
            </div>
            <div className="rounded-xl border border-line p-3 text-sm">
              <p className="font-medium">Use this style</p>
              <p className="mt-1 text-muted">In any tool, choose <b>{board.name}</b> under “Style board”. To restyle an existing image, use <b>Restyle</b> in the Gallery.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link className="text-accent hover:underline" href={`/studio/environment_switch?style=${board.id}`}>Environment →</Link>
                <Link className="text-accent hover:underline" href={`/studio/photoshoot?style=${board.id}`}>Photoshoot →</Link>
                <Link className="text-accent hover:underline" href={`/studio/headshots?style=${board.id}`}>Headshots →</Link>
              </div>
            </div>
            {busy === "save" && <p className="text-xs text-muted">Saving…</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
