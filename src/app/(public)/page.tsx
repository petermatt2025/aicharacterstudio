import { ButtonLink, Card, Badge } from "@/components/ui";
import { STUDIOS } from "@/lib/catalog";
import { listFeatures } from "@/server/entitlements";

const STEPS = [
  ["Upload once", "Add a clear photo of yourself (or someone who gave permission) and save it as a Character."],
  ["Pick a tool", "Angles, new environments, product mixes or UGC ad concepts. See the credit cost before you start."],
  ["Get private results", "Images land in your private gallery. Download, regenerate, or delete them any time."],
];

const FAQ = [
  ["Will every image look exactly like me?", "No tool can guarantee that. Identity Lock improves consistency, but faces, hands, logos and text can drift. You can regenerate, and you are charged only for delivered images."],
  ["Who can see my photos?", "Only you. Uploads and results are stored privately and every download is checked against your account. You can delete them at any time."],
  ["Can I upload photos of other people?", "Only with their explicit permission. You confirm this on every upload. Impersonation and non-consensual imagery are prohibited."],
  ["Can I use images in ads?", "You can use outputs commercially where the image provider's terms and your rights in the inputs allow it. Ad concepts are synthetic and must not be presented as real customers or real results."],
  ["What is a credit?", "Credits are spent per delivered image. Simple images cost fewer credits than multi-reference or high-quality ones. The exact cost is shown before you generate."],
];

export default async function Landing() {
  const features = await listFeatures();
  const tools = features.filter((f) => f.tool_number !== null);
  const available = features.filter((f) => f.release_state === "live" || f.release_state === "beta");
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="grid items-center gap-10 py-16 md:grid-cols-2 md:py-24">
        <div>
          <Badge tone="beta">Private beta</Badge>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Upload your photo once.<br />
            <span className="text-accent">Create a whole photoshoot.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Consistent character scenes, new angles, product mixes and UGC ad concepts from reusable references, with transparent credit pricing and a private library.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/signup" className="px-6 py-3 text-base">Start with 15 free credits</ButtonLink>
            <ButtonLink href="/pricing" variant="secondary" className="px-6 py-3 text-base">See pricing</ButtonLink>
          </div>
          <p className="mt-4 text-xs text-muted">No card needed for the trial. Results vary; likeness is never guaranteed.</p>
        </div>
        <div className="grid grid-cols-2 gap-3" aria-label="Illustrative examples">
          {["Your portrait", "Café scene", "Studio headshot", "Product in hand"].map((t, i) => (
            <figure key={t} className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-line" style={{ background: `linear-gradient(${140 + i * 30}deg, #2a2a31, hsl(${12 + i * 18} 60% ${30 + i * 4}%))` }}>
              <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 p-3 text-sm">
                {t}
                <span className="mt-1 block text-[10px] uppercase tracking-wider text-white/60">Illustrative placeholder</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section id="how" className="py-12">
        <h2 className="text-2xl font-semibold">How it works</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map(([t, d], i) => (
            <Card key={t}>
              <span className="text-sm font-semibold text-accent">Step {i + 1}</span>
              <h3 className="mt-2 font-semibold">{t}</h3>
              <p className="mt-2 text-sm text-muted">{d}</p>
            </Card>
          ))}
        </ol>
      </section>

      <section className="py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold">Six studios, {tools.length} tools on the roadmap</h2>
          <p className="text-sm text-muted">{available.length} available in beta today. The rest are clearly marked as coming soon.</p>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STUDIOS.map((s) => {
            const fs = features.filter((f) => f.studio === s.key);
            return (
              <Card key={s.key}>
                <h3 className="font-semibold">{s.name}</h3>
                <p className="mt-1 text-sm text-muted">{s.blurb}</p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {fs.slice(0, 5).map((f) => (
                    <li key={f.key} className="flex items-center justify-between gap-2">
                      <span className={f.release_state === "live" || f.release_state === "beta" ? "" : "text-muted"}>{f.name}</span>
                      <Badge tone={f.release_state} />
                    </li>
                  ))}
                  {fs.length > 5 && <li className="text-xs text-muted">+{fs.length - 5} more on the roadmap</li>}
                </ul>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="py-12">
        <h2 className="text-2xl font-semibold">Questions</h2>
        <div className="mt-6 divide-y divide-line rounded-2xl border border-line bg-surface">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group p-5">
              <summary className="cursor-pointer list-none font-medium">{q}</summary>
              <p className="mt-2 text-sm text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="py-12 text-center">
        <h2 className="text-3xl font-semibold">Try it with your own photo</h2>
        <p className="mt-2 text-muted">15 one-time trial credits. Watermarked previews on the free plan.</p>
        <ButtonLink href="/signup" className="mt-6 px-6 py-3 text-base">Create your account</ButtonLink>
      </section>
    </div>
  );
}
