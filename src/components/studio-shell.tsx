"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ASPECT_RATIOS, IDENTITY_LOCK, type ToolDef } from "@/lib/tools";
import { buildDirection, groupsForTool, surprise, TOOL_IDEAS, type BuilderChoices, type BuilderGroupKey } from "@/lib/prompt-builder";
import { api, ApiError, fileUrl } from "@/lib/api";
import { AssetPicker, type AssetLite } from "./uploader";
import { Badge, Button, ButtonLink, Card, Field, Notice, cx, inputCls } from "./ui";

type Character = { id: string; name: string; primary_asset_id: string | null; identity_strength: "loose" | "balanced" | "strict" };
type Quote = { quoteId: string; credits: number; outputs: number; expiresAt: string; balance: number; sufficient: boolean; warnings: string[]; breakdown: { chargePolicy: string; ruleKey: string; perOutput: number; multiplier: number } };
type Job = { id: string; status: string; outputsRequested: number; outputsDelivered: number; creditsReserved: number; creditsCharged: number; errorCode: string | null; errorMessage: string | null; warnings: string[]; cancelRequested: boolean; outputs: Array<{ assetId: string; index: number; width: number; height: number; watermarked: boolean }> };
type Access = { ok: true; beta: boolean } | { ok: false; reason: string; message: string; requiredPlan?: string };

const TERMINAL = new Set(["succeeded", "partial", "failed", "canceled", "rejected"]);

type EngineOption = { key: "openai" | "gemini"; label: string; hint: string };

export function StudioShell({ tool, access, characters, initialAssets, emailVerified, engines = [], initialSlots = {}, initialPresets, initialPrompt }: { tool: ToolDef; access: Access; characters: Character[]; initialAssets: AssetLite[]; emailVerified: boolean; engines?: EngineOption[]; initialSlots?: Record<string, string>; initialPresets?: string[]; initialPrompt?: string }) {
  const router = useRouter();
  const [assets, setAssets] = useState(initialAssets);
  const [characterId, setCharacterId] = useState<string | null>(characters[0]?.id ?? null);
  const [slots, setSlots] = useState<Record<string, string | null>>(initialSlots);
  const [presets, setPresets] = useState<string[]>(initialPresets?.length ? initialPresets : tool.defaultPresets);
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [idea, setIdea] = useState("");
  const [choices, setChoices] = useState<BuilderChoices>({});
  const [lastAuto, setLastAuto] = useState("");
  const [aspectRatio, setAspect] = useState(tool.defaultAspect);
  const [quality, setQuality] = useState<"standard" | "high">("standard");
  const [variations, setVariations] = useState(1);
  const [engine, setEngine] = useState<EngineOption["key"] | undefined>(engines[0]?.key);
  const [identity, setIdentity] = useState<"loose" | "balanced" | "strict">(characters[0]?.identity_strength ?? "balanced");
  const [quoteState, setQuoteState] = useState<{ q: Quote; fp: string } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState<"quote" | "submit" | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const idem = useRef<string>("");

  const characterSlot = tool.slots.find((s) => s.role === "character");
  const useSaved = !!characterSlot && characterId !== null;

  // Any input change invalidates the quote (quotes are immutable on the server).
  const fingerprint = JSON.stringify([characterId, slots, presets, prompt, aspectRatio, quality, variations, identity, engine]);
  const quote = quoteState && quoteState.fp === fingerprint ? quoteState.q : null;
  const setQuote = (q: Quote | null) => setQuoteState(q ? { q, fp: fingerprint } : null);

  // Poll the job until it finishes.
  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ job: Job }>(`/api/generations/${job.id}`);
        setJob(r.job);
        if (TERMINAL.has(r.job.status)) router.refresh();
      } catch {
        /* transient; keep polling */
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [job, router]);

  const references = useMemo(
    () =>
      tool.slots
        .filter((s) => !(s.role === "character" && useSaved))
        .map((s) => ({ role: s.role, assetId: slots[s.role] }))
        .filter((r): r is { role: typeof r.role; assetId: string } => !!r.assetId),
    [tool.slots, slots, useSaved],
  );

  function requestBody() {
    return { featureKey: tool.key, characterId: useSaved ? characterId : undefined, references, prompt, presetKeys: presets, aspectRatio, quality, variations, identityStrength: identity, engine };
  }

  async function getQuote() {
    setBusy("quote");
    setError(null);
    try {
      const q = await api<Quote>("/api/generations/quote", { body: requestBody() });
      idem.current = crypto.randomUUID();
      setQuote(q);
    } catch (e) {
      setError({ message: (e as Error).message, code: (e as ApiError).code });
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    if (!quote) return;
    setBusy("submit");
    setError(null);
    try {
      const r = await api<{ jobId: string }>("/api/generations", { body: { quoteId: quote.quoteId, idempotencyKey: idem.current } });
      const j = await api<{ job: Job }>(`/api/generations/${r.jobId}`);
      setJob(j.job);
      setQuote(null);
      router.refresh();
    } catch (e) {
      setError({ message: (e as Error).message, code: (e as ApiError).code });
      if ((e as ApiError).code === "quote_expired" || (e as ApiError).code === "quote_used") setQuote(null);
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!job) return;
    await api(`/api/generations/${job.id}/cancel`, { method: "POST" }).catch(() => {});
    const r = await api<{ job: Job }>(`/api/generations/${job.id}`);
    setJob(r.job);
    router.refresh();
  }

  function togglePreset(k: string) {
    setPresets((p) => {
      if (p.includes(k)) return p.filter((x) => x !== k);
      if (tool.maxPresets === 1) return [k];
      return p.length >= tool.maxPresets ? p : [...p, k];
    });
  }

  /** Prompt Builder: write the prompt from the chosen idea + options, unless the user has typed their own. */
  function applyBuilder(nextIdea: string, nextChoices: BuilderChoices, force = false) {
    setIdea(nextIdea);
    setChoices(nextChoices);
    const text = buildDirection(tool.key, nextIdea, nextChoices);
    if (force || !prompt.trim() || prompt === lastAuto) {
      setPrompt(text);
      setLastAuto(text);
    }
  }
  function toggleChoice(g: BuilderGroupKey, key: string) {
    applyBuilder(idea, { ...choices, [g]: choices[g] === key ? undefined : key });
  }
  const builderText = buildDirection(tool.key, idea, choices);
  const promptEdited = !!prompt.trim() && prompt !== lastAuto && !!builderText && prompt !== builderText;

  const locked = !access.ok;
  const inputsDisabled = locked || !emailVerified || (job !== null && !TERMINAL.has(job.status));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        {!emailVerified && <Notice tone="warn">Verify your email to generate images.</Notice>}
        {!access.ok && (
          <Notice tone="warn">
            {access.message}{" "}
            {access.reason === "plan_required" && <Link href="/pricing" className="underline">See plans</Link>}
          </Notice>
        )}

        <Card>
          <h2 className="font-semibold">1. References</h2>
          <div className="mt-4 space-y-5">
            {tool.slots.map((slot) => (
              <div key={slot.role}>
                <p className="text-sm font-medium">
                  {slot.label} {slot.required && <span className="text-accent">*</span>}
                </p>
                <p className="mb-2 text-xs text-muted">{slot.hint}</p>
                {slot.role === "character" && characters.length > 0 && (
                  <div className="mb-3">
                    <label htmlFor="character" className="sr-only">Saved character</label>
                    <select id="character" className={inputCls} value={characterId ?? ""} disabled={inputsDisabled} onChange={(e) => {
                      const v = e.target.value || null;
                      setCharacterId(v);
                      const ch = characters.find((c) => c.id === v);
                      if (ch) setIdentity(ch.identity_strength);
                    }}>
                      {characters.map((c) => <option key={c.id} value={c.id}>Saved character: {c.name}</option>)}
                      <option value="">Use a single photo instead</option>
                    </select>
                  </div>
                )}
                {!(slot.role === "character" && useSaved) && (
                  <AssetPicker kind={slot.uploadKind} includeOutputs={!!slot.pickOutputs} label={slot.label} assets={assets} value={slots[slot.role] ?? null} onChange={(id) => setSlots((s) => ({ ...s, [slot.role]: id }))} onUploaded={(a) => setAssets((x) => [a, ...x])} />
                )}
              </div>
            ))}
            <p className="text-xs text-muted">Up to 4 references. Text visible inside images is treated as picture content, never as instructions.</p>
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold">2. {tool.presetLabel}</h2>
          <p className="mt-1 text-xs text-muted">{tool.presetMode === "shots" ? "Each selection becomes its own image." : "Applied as a style to every image."} Choose up to {tool.maxPresets}.</p>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={tool.presetLabel}>
            {tool.presets.map((p) => (
              <button key={p.key} type="button" disabled={inputsDisabled} aria-pressed={presets.includes(p.key)} onClick={() => togglePreset(p.key)} className={cx("rounded-full border px-3 py-1.5 text-sm", presets.includes(p.key) ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink")}>
                {p.label}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold">3. Direction</h2>
          <p className="mt-1 text-xs text-muted">Pick an idea and a few options, and the prompt is written for you. You can still edit it.</p>

          {(TOOL_IDEAS[tool.key]?.length ?? 0) > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium">Ideas</p>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Ideas">
                {TOOL_IDEAS[tool.key]!.map((x) => (
                  <button key={x.label} type="button" disabled={inputsDisabled} aria-pressed={idea === x.text} title={x.text} onClick={() => applyBuilder(idea === x.text ? "" : x.text, choices)}
                    className={cx("rounded-full border px-3 py-1 text-sm", idea === x.text ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink")}>
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {groupsForTool(tool.key).map((g) => (
              <div key={g.key} className="sm:flex sm:items-start sm:gap-3">
                <p className="w-24 shrink-0 pt-1 text-sm font-medium">{g.label}</p>
                <div className="mt-1 flex flex-wrap gap-1.5 sm:mt-0" role="group" aria-label={g.label}>
                  {g.options.map((o) => (
                    <button key={o.key} type="button" disabled={inputsDisabled} aria-pressed={choices[g.key] === o.key} onClick={() => toggleChoice(g.key, o.key)}
                      className={cx("rounded-full border px-2.5 py-0.5 text-xs", choices[g.key] === o.key ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink")}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" disabled={inputsDisabled} onClick={() => { const r = surprise(tool.key); applyBuilder(r.idea, r.choices, true); }}>🎲 Surprise me</Button>
            {promptEdited && <Button type="button" variant="ghost" disabled={inputsDisabled} onClick={() => applyBuilder(idea, choices, true)}>Rewrite prompt from my choices</Button>}
            {(idea || Object.values(choices).some(Boolean)) && <Button type="button" variant="ghost" disabled={inputsDisabled} onClick={() => applyBuilder("", {}, true)}>Clear</Button>}
          </div>

          <Field label="Prompt" htmlFor="prompt" hint="Written from your choices above. Edit freely.">
            <textarea id="prompt" rows={tool.key === "reference_mixer" ? 6 : 5} maxLength={2000} disabled={inputsDisabled} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={tool.promptPlaceholder} className={inputCls} />
          </Field>
          <div className="mt-1 text-right text-xs text-muted">{prompt.length}/2000</div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field label="Aspect ratio" htmlFor="ar">
              <select id="ar" className={inputCls} value={aspectRatio} disabled={inputsDisabled} onChange={(e) => setAspect(e.target.value as typeof aspectRatio)}>
                {ASPECT_RATIOS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Quality" htmlFor="quality">
              <select id="quality" className={inputCls} value={quality} disabled={inputsDisabled} onChange={(e) => setQuality(e.target.value as "standard" | "high")}>
                <option value="standard">Standard</option>
                <option value="high">High (more credits)</option>
              </select>
            </Field>
            {engines.length > 1 && (
              <Field label="Engine" htmlFor="engine" hint={engines.find((x) => x.key === engine)?.hint}>
                <select id="engine" className={inputCls} value={engine} disabled={inputsDisabled} onChange={(e) => setEngine(e.target.value as EngineOption["key"])}>
                  {engines.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </Field>
            )}
            {tool.allowVariations && (
              <Field label={tool.presetMode === "shots" ? "Variations per selection" : "Variations"} htmlFor="var">
                <select id="var" className={inputCls} value={variations} disabled={inputsDisabled} onChange={(e) => setVariations(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}
                </select>
              </Field>
            )}
            {characterSlot && (
              <Field label="Identity Lock" htmlFor="identity" hint={IDENTITY_LOCK[identity].help}>
                <select id="identity" className={inputCls} value={identity} disabled={inputsDisabled} onChange={(e) => setIdentity(e.target.value as typeof identity)}>
                  {(["loose", "balanced", "strict"] as const).map((k) => <option key={k} value={k}>{IDENTITY_LOCK[k].label}</option>)}
                </select>
              </Field>
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <Card>
          <h2 className="font-semibold">Cost and generate</h2>
          {!quote && (
            <>
              <p className="mt-2 text-sm text-muted">Get an exact quote before anything is reserved.</p>
              <Button className="mt-4 w-full" onClick={getQuote} disabled={inputsDisabled || busy !== null}>{busy === "quote" ? "Calculating…" : "Review cost"}</Button>
            </>
          )}
          {quote && (
            <div className="mt-3 space-y-3" data-testid="quote">
              <p className="text-3xl font-semibold">{quote.credits} <span className="text-base font-normal text-muted">credits</span></p>
              <p className="text-sm text-muted">{quote.outputs} image{quote.outputs > 1 ? "s" : ""} · balance {quote.balance} → {Math.max(0, quote.balance - quote.credits)}</p>
              <p className="text-xs text-muted">{quote.breakdown.chargePolicy}</p>
              {quote.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
              {quote.sufficient ? (
                <Button className="w-full" onClick={generate} disabled={busy !== null}>{busy === "submit" ? "Starting…" : `Generate for ${quote.credits} credits`}</Button>
              ) : (
                <>
                  <Notice tone="error">Not enough credits for this request.</Notice>
                  <ButtonLink href="/billing" className="w-full">Get more credits</ButtonLink>
                </>
              )}
              <Button variant="ghost" className="w-full" onClick={() => setQuote(null)}>Change settings</Button>
            </div>
          )}
          {error && (
            <div className="mt-3 space-y-2">
              <Notice tone="error">{error.message}</Notice>
              {(error.code === "insufficient_credits" || error.code === "plan_required") && <ButtonLink href={error.code === "plan_required" ? "/pricing" : "/billing"} variant="secondary" className="w-full">{error.code === "plan_required" ? "See plans" : "Top up credits"}</ButtonLink>}
            </div>
          )}
        </Card>

        {job && <JobPanel job={job} onCancel={cancel} onRegenerate={() => { setJob(null); getQuote(); }} />}

        <Card>
          <h2 className="text-sm font-semibold">Good to know</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
            {tool.warnings.map((w) => <li key={w}>{w}</li>)}
            <li>Results are private to your account until you download them.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function JobPanel({ job, onCancel, onRegenerate }: { job: Job; onCancel: () => void; onRegenerate: () => void }) {
  const done = TERMINAL.has(job.status);
  const tone = job.status === "succeeded" ? "live" : job.status === "partial" ? "coming_soon" : done ? "paused" : "beta";
  return (
    <Card data-testid="job-panel">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Results</h2>
        <Badge tone={tone}>{job.status === "queued" ? "Queued" : job.status === "running" ? "Generating" : job.status}</Badge>
      </div>
      <div className="mt-3">
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={job.outputsRequested} aria-valuenow={job.outputsDelivered} aria-label="Images delivered">
          <div className="h-full bg-accent transition-all" style={{ width: `${(job.outputsDelivered / job.outputsRequested) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">{job.outputsDelivered} of {job.outputsRequested} images · {done ? `charged ${job.creditsCharged} of ${job.creditsReserved} reserved credits` : `${job.creditsReserved} credits reserved`}</p>
      </div>
      {job.errorMessage && <div className="mt-3"><Notice tone={job.status === "partial" || job.status === "queued" ? "warn" : "error"}>{job.errorMessage}</Notice></div>}
      {job.warnings.map((w) => <p key={w} className="mt-2 text-xs text-warn">{w}</p>)}
      {job.outputs.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-2">
          {job.outputs.map((o) => (
            <li key={o.assetId} className="group relative overflow-hidden rounded-lg border border-line">
              <a href={fileUrl(o.assetId)} target="_blank" rel="noreferrer">
                <img src={fileUrl(o.assetId, { thumb: true })} alt={`Generated image ${o.index + 1}`} className="aspect-square w-full object-cover" />
              </a>
              <a href={fileUrl(o.assetId, { download: true })} className="absolute bottom-1 right-1 rounded bg-black/70 px-2 py-0.5 text-xs">Download</a>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {!done && !job.cancelRequested && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        {done && job.outputs.length > 1 && <a href={`/api/generations/${job.id}/zip`} className="inline-flex items-center rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm">Download ZIP</a>}
        {done && <Button variant="secondary" onClick={onRegenerate}>Regenerate</Button>}
      </div>
      <p className="mt-3 text-xs text-muted">AI-generated. Check likeness, hands, products and text before using commercially.</p>
    </Card>
  );
}
