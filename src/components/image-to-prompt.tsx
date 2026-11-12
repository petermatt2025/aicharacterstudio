"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { AssetPicker, type AssetLite } from "./uploader";
import { Button, Card, Field, Notice, inputCls } from "./ui";

type Analysis = { subject: string; setting: string; style: string; lighting: string; camera: string; mood: string; colors: string; prompt: string };
const LABELS: Array<[keyof Analysis, string]> = [["subject", "Subject"], ["setting", "Setting"], ["style", "Style"], ["lighting", "Lighting"], ["camera", "Camera"], ["mood", "Mood"], ["colors", "Colors"]];

export function ImageToPrompt({ initialAssets, tools, disabledReason, initialSource }: { initialAssets: AssetLite[]; tools: Array<{ key: string; title: string }>; disabledReason: string | null; initialSource?: string }) {
  const [assets, setAssets] = useState(initialAssets);
  const [assetId, setAssetId] = useState<string | null>(initialSource ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState(tools[0]?.key ?? "");
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  async function analyze() {
    if (!assetId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ analysis: Analysis }>("/api/tools/image-to-prompt", { body: { assetId } });
      setResult(r.analysis);
      setPrompt(r.analysis.prompt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="space-y-4">
        <h2 className="font-semibold">1. Pick an image</h2>
        {disabledReason && <Notice tone="warn">{disabledReason}</Notice>}
        <AssetPicker kind="other" includeOutputs label="Image" assets={assets} value={assetId} onChange={setAssetId} onUploaded={(a) => setAssets((x) => [a, ...x])} />
        <p className="text-xs text-muted">Free to use. The analysis describes people generically and never identifies anyone.</p>
        <Button onClick={analyze} disabled={!assetId || busy || !!disabledReason}>{busy ? "Analyzing…" : "Write the prompt"}</Button>
        {error && <Notice tone="error">{error}</Notice>}
      </Card>
      <Card className="space-y-4">
        <h2 className="font-semibold">2. Your prompt</h2>
        {!result ? (
          <p className="text-sm text-muted">The structured description and a ready-to-use prompt appear here.</p>
        ) : (
          <>
            <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1 text-sm">
              {LABELS.map(([k, label]) => result[k] && (
                <div key={k} className="contents"><dt className="text-muted">{label}</dt><dd>{result[k]}</dd></div>
              ))}
            </dl>
            <Field label="Prompt (edit freely)" htmlFor="i2p">
              <textarea id="i2p" rows={7} maxLength={2000} value={prompt} onChange={(e) => setPrompt(e.target.value)} className={inputCls} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(prompt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Copied ✓" : "Copy"}</Button>
              <select aria-label="Use in tool" className={inputCls + " w-auto"} value={target} onChange={(e) => setTarget(e.target.value)}>
                {tools.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
              </select>
              <Button onClick={() => router.push(`/studio/${target}?prompt=${encodeURIComponent(prompt.slice(0, 2000))}`)} disabled={!target}>Use in tool →</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
