"use client";
import { useId, useState } from "react";
import { ALLOWED_CONSENT, CONSENT_LABELS, type ConsentSubject, type UploadKind } from "@/lib/consent";
import { api, fileUrl } from "@/lib/api";
import { Button, Notice, cx } from "./ui";

export type AssetLite = { id: string; kind: string; title: string; width: number; height: number; createdAt: string; featureKey?: string | null; favorite?: boolean; watermarked?: boolean };

/** Upload with a mandatory rights/consent confirmation. The server re-validates everything. */
export function Uploader({ kind, onUploaded, compact }: { kind: UploadKind; onUploaded: (a: AssetLite) => void; compact?: boolean }) {
  const id = useId();
  const options = ALLOWED_CONSENT[kind];
  const [consent, setConsent] = useState<ConsentSubject | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file || !consent) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);
    form.set("consent", consent);
    form.set("title", file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 100));
    try {
      const r = await api<{ asset: AssetLite }>("/api/assets", { form });
      onUploaded(r.asset);
      setFile(null);
      setConsent(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cx("space-y-3 rounded-xl border border-dashed border-line p-4", compact && "p-3")}>
      <label htmlFor={`${id}-file`} className="block text-sm font-medium">Upload a {kind} image</label>
      <input id={`${id}-file`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-ink" />
      <p className="text-xs text-muted">PNG, JPEG or WebP up to 15 MB. Location and camera metadata are removed automatically.</p>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-sm font-medium">Rights and consent (required)</legend>
        {options.map((o) => (
          <label key={o} className="flex items-start gap-2 text-sm">
            <input type="radio" name={`${id}-consent`} checked={consent === o} onChange={() => setConsent(o)} className="mt-1 accent-[var(--color-accent)]" />
            <span>{CONSENT_LABELS[o]}</span>
          </label>
        ))}
      </fieldset>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="button" onClick={submit} disabled={!file || !consent || busy} variant="secondary">{busy ? "Uploading…" : "Upload"}</Button>
    </div>
  );
}

/** Choose an existing private asset of a kind, or upload a new one. */
export function AssetPicker({ kind, assets, value, onChange, onUploaded, label, includeOutputs = false }: { kind: UploadKind; assets: AssetLite[]; value: string | null; onChange: (id: string | null) => void; onUploaded: (a: AssetLite) => void; label: string; includeOutputs?: boolean }) {
  const [open, setOpen] = useState(false);
  const mine = assets.filter((a) => a.kind === kind || (includeOutputs && a.kind === "output"));
  const selected = assets.find((a) => a.id === value);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-bg">
          {selected ? <img src={fileUrl(selected.id, { thumb: true })} alt={selected.title} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-xs text-muted">Empty</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>{selected ? "Replace" : `Choose ${label.toLowerCase()}`}</Button>
          {selected && <Button type="button" variant="ghost" onClick={() => onChange(null)}>Remove</Button>}
        </div>
      </div>
      {open && (
        <div className="space-y-3 rounded-xl border border-line bg-bg p-3">
          {mine.length > 0 ? (
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {mine.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => { onChange(a.id); setOpen(false); }} className={cx("block aspect-square w-full overflow-hidden rounded-lg border", a.id === value ? "border-accent" : "border-line")} aria-label={`Use ${a.title}`}>
                    <img src={fileUrl(a.id, { thumb: true })} alt="" className="h-full w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No {kind} images yet.</p>
          )}
          <Uploader kind={kind} compact onUploaded={(a) => { onUploaded(a); onChange(a.id); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}
