"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fileUrl } from "@/lib/api";
import { FONTS, LOOKS, cssFont, drawLayer, newLayer, type Box, type Frame, type Shadow, type TextLayer } from "@/lib/text-layers";
import { Button, Card, Field, Notice, cx, inputCls } from "./ui";

const POSITIONS: Array<[string, number, number]> = [
  ["↖", 0.25, 0.12], ["↑", 0.5, 0.12], ["↗", 0.75, 0.12],
  ["←", 0.25, 0.5], ["●", 0.5, 0.5], ["→", 0.75, 0.5],
  ["↙", 0.25, 0.88], ["↓", 0.5, 0.88], ["↘", 0.75, 0.88],
];
const FRAMES: Array<[Frame, string]> = [["none", "None"], ["box", "Box"], ["pill", "Pill"], ["outline", "Outline"], ["banner", "Banner"]];
const SHADOWS: Array<[Shadow, string]> = [["none", "None"], ["soft", "Soft"], ["hard", "Hard"], ["glow", "Glow"]];
const SWATCHES = ["#ffffff", "#000000", "#ffe600", "#ff2d55", "#ff7a45", "#ff5ef4", "#8b5cff", "#2ec4ff", "#22c55e"];

function Swatches({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {SWATCHES.map((c) => (
        <button key={c} type="button" aria-label={`${label} ${c}`} aria-pressed={value.toLowerCase() === c} onClick={() => onChange(c)}
          className={cx("h-6 w-6 rounded-full border", value.toLowerCase() === c ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : "border-white/20")} style={{ background: c }} />
      ))}
      <input type="color" aria-label={`${label} custom`} value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent" />
    </div>
  );
}

function Range({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; fmt?: (n: number) => string }) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between"><span>{label}</span><span className="text-muted">{fmt ? fmt(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[#ff6b4e]" />
    </label>
  );
}

export function TextStudio({ assetId, width, height, title }: { assetId: string; width: number; height: number; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxes = useRef<Box[]>([]);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [layers, setLayers] = useState<TextLayer[]>(() => [newLayer({ text: "Your headline", y: 0.12, font: "anton", upper: true, size: 0.09, stroke: 0.1, shadow: "hard" })]);
  const [selected, setSelected] = useState<string>(layers[0]!.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const layer = layers.find((l) => l.id === selected) ?? null;

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setError("Couldn't load the image.");
    i.src = fileUrl(assetId);
  }, [assetId]);

  // Redraw whenever the image or any layer changes (after the layer fonts are loaded).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    let cancelled = false;
    void Promise.all(layers.map((l) => document.fonts.load(cssFont(l, 64), l.text || "A").catch(() => []))).then(() => {
      if (cancelled) return;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      boxes.current = layers.filter((l) => l.text.trim()).map((l) => drawLayer(ctx, l, width, height));
    });
    return () => { cancelled = true; };
  }, [img, layers, width, height]);

  const update = (patch: Partial<TextLayer>) => setLayers((ls) => ls.map((l) => (l.id === selected ? { ...l, ...patch } : l)));
  function addLayer() {
    const l = newLayer({ y: 0.5 + ((layers.length % 3) - 1) * 0.2 });
    setLayers((ls) => [...ls, l]);
    setSelected(l.id);
  }
  function removeLayer() {
    if (!layer) return;
    const rest = layers.filter((l) => l.id !== layer.id);
    setLayers(rest);
    setSelected(rest.at(-1)?.id ?? "");
  }

  function toImage(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  }
  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = toImage(e);
    const hit = [...boxes.current].reverse().find((b) => Math.abs(p.x - b.cx) <= b.hw && Math.abs(p.y - b.cy) <= b.hh);
    if (!hit) return;
    setSelected(hit.id);
    drag.current = { id: hit.id, dx: p.x - hit.cx, dy: p.y - hit.cy };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current) return;
    const p = toImage(e);
    const { id, dx, dy } = drag.current;
    const x = Math.min(1, Math.max(0, (p.x - dx) / width));
    const y = Math.min(1, Math.max(0, (p.y - dy) / height));
    setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, x, y } : l)));
  }

  async function blob(): Promise<Blob> {
    return new Promise((res, rej) => canvasRef.current!.toBlob((b) => (b ? res(b) : rej(new Error("Export failed"))), "image/png"));
  }
  async function download() {
    const b = await blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `${title.replace(/[^\w-]+/g, "_").slice(0, 40) || "image"}_text.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", await blob(), "text.png");
      form.set("texts", JSON.stringify(layers.map((l) => l.text).filter((t) => t.trim())));
      const res = await fetch(`/api/assets/${assetId}/text`, { method: "POST", body: form });
      const j = (await res.json()) as { asset?: { id: string }; error?: { message: string } };
      if (!res.ok || !j.asset) throw new Error(j.error?.message ?? "Couldn't save.");
      setSavedId(j.asset.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
        <div className="overflow-hidden rounded-2xl border border-line bg-[repeating-conic-gradient(#222_0%_25%,#1a1a1a_0%_50%)] bg-[length:24px_24px]">
          <canvas ref={canvasRef} width={width} height={height} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}
            className="mx-auto block max-h-[78vh] w-auto max-w-full cursor-move touch-none" aria-label="Image with text layers. Drag text to move it." />
        </div>
        <p className="text-xs text-muted">Tip: drag any text on the image to move it. Text is drawn exactly as typed, with no AI spelling mistakes.</p>
      </div>

      <div className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        {savedId && (
          <Notice tone="ok">
            Saved to your gallery as a new image. <Link href="/gallery" className="underline">Open gallery</Link> · <Link href={`/text/${savedId}`} className="underline">Keep editing the copy</Link>
          </Notice>
        )}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Text layers</h2>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={addLayer} disabled={layers.length >= 12}>＋ Add text</Button>
              {layer && <Button variant="ghost" onClick={removeLayer}>Delete</Button>}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {layers.map((l, i) => (
              <button key={l.id} type="button" onClick={() => setSelected(l.id)} aria-pressed={l.id === selected}
                className={cx("max-w-[10rem] truncate rounded-full border px-3 py-1 text-xs", l.id === selected ? "border-accent bg-accent/15 text-accent" : "border-line text-muted")}>
                {i + 1}. {l.text || "(empty)"}
              </button>
            ))}
          </div>
        </Card>

        {layer && (
          <Card className="space-y-4">
            <Field label="Text" htmlFor="tl-text" hint="Press Enter for a new line.">
              <textarea id="tl-text" rows={2} maxLength={500} className={inputCls} value={layer.text} onChange={(e) => update({ text: e.target.value })} />
            </Field>

            <div>
              <p className="text-sm font-medium">Quick looks</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {LOOKS.map((k) => (
                  <button key={k.key} type="button" onClick={() => update(k.patch)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-ink">{k.label}</button>
                ))}
              </div>
            </div>

            <Field label="Font" htmlFor="tl-font">
              <select id="tl-font" className={inputCls} value={layer.font} onChange={(e) => update({ font: e.target.value as TextLayer["font"] })}>
                {FONTS.map((f) => <option key={f.key} value={f.key} style={{ fontFamily: `"${f.family}"` }}>{f.label}</option>)}
              </select>
            </Field>
            <div className="flex flex-wrap gap-2 text-sm">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={layer.upper} onChange={(e) => update({ upper: e.target.checked })} /> UPPERCASE</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={layer.italic} onChange={(e) => update({ italic: e.target.checked })} /> <i>Italic</i></label>
              <span className="ml-auto flex gap-1">
                {(["left", "center", "right"] as const).map((a) => (
                  <button key={a} type="button" aria-pressed={layer.align === a} onClick={() => update({ align: a })} className={cx("rounded border px-2 py-0.5 text-xs", layer.align === a ? "border-accent text-accent" : "border-line text-muted")}>{a}</button>
                ))}
              </span>
            </div>
            <Range label="Size" value={layer.size} min={0.02} max={0.25} step={0.005} onChange={(size) => update({ size })} fmt={(n) => `${Math.round(n * 100)}%`} />
            <div>
              <p className="mb-1.5 text-sm">Text colour</p>
              <Swatches label="Text colour" value={layer.color} onChange={(color) => update({ color })} />
            </div>
            <Range label="Outline" value={layer.stroke} min={0} max={0.2} step={0.01} onChange={(stroke) => update({ stroke })} fmt={(n) => (n ? `${Math.round(n * 100)}` : "off")} />
            {layer.stroke > 0 && <Swatches label="Outline colour" value={layer.strokeColor} onChange={(strokeColor) => update({ strokeColor })} />}
            <div>
              <p className="mb-1.5 text-sm">Shadow</p>
              <div className="flex gap-1.5">
                {SHADOWS.map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={layer.shadow === k} onClick={() => update({ shadow: k })} className={cx("rounded-full border px-2.5 py-1 text-xs", layer.shadow === k ? "border-accent text-accent" : "border-line text-muted")}>{label}</button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-sm">Frame</p>
              <div className="flex flex-wrap gap-1.5">
                {FRAMES.map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={layer.frame === k} onClick={() => update({ frame: k })} className={cx("rounded-full border px-2.5 py-1 text-xs", layer.frame === k ? "border-accent text-accent" : "border-line text-muted")}>{label}</button>
                ))}
              </div>
            </div>
            {layer.frame !== "none" && (
              <>
                <Swatches label="Frame colour" value={layer.frameColor} onChange={(frameColor) => update({ frameColor })} />
                <Range label="Frame opacity" value={layer.frameOpacity} min={0.1} max={1} step={0.05} onChange={(frameOpacity) => update({ frameOpacity })} fmt={(n) => `${Math.round(n * 100)}%`} />
                <Range label="Padding" value={layer.padding} min={0.1} max={1.2} step={0.05} onChange={(padding) => update({ padding })} />
              </>
            )}

            <div>
              <p className="mb-1.5 text-sm">Position</p>
              <div className="grid w-28 grid-cols-3 gap-1">
                {POSITIONS.map(([g, x, y]) => (
                  <button key={g} type="button" aria-label={`Move to ${g}`} onClick={() => update({ x, y })} className="rounded border border-line py-1 text-xs text-muted hover:border-accent hover:text-ink">{g}</button>
                ))}
              </div>
            </div>
            <Range label="Rotation" value={layer.rotation} min={-45} max={45} step={1} onChange={(rotation) => update({ rotation })} fmt={(n) => `${n}°`} />
            <Range label="Letter spacing" value={layer.letterSpacing} min={-0.05} max={0.3} step={0.01} onChange={(letterSpacing) => update({ letterSpacing })} />
            <Range label="Opacity" value={layer.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => update({ opacity })} fmt={(n) => `${Math.round(n * 100)}%`} />
          </Card>
        )}

        <Card className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={busy || !img || !layers.some((l) => l.text.trim())}>{busy ? "Saving…" : "💾 Save as new image"}</Button>
          <Button variant="secondary" onClick={() => void download()} disabled={!img}>Download PNG</Button>
          <span className="w-full text-xs text-muted">Your original stays unchanged. Free, no credits used.</span>
        </Card>
      </div>
    </div>
  );
}
