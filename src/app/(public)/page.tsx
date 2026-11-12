import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { STUDIOS } from "@/lib/catalog";
import { listFeatures } from "@/server/entitlements";

// Showcase images: AI-generated with this app's engines; every person shown is fictional.
const S = (n: string) => `/showcase/${n}.webp`;
const VARIANTS: Array<[string, string, string]> = [
  ["cafe", "Café morning", "Environment & Lifestyle"],
  ["beach", "Sunset beach", "Environment & Lifestyle"],
  ["headshot", "Studio headshot", "Headshot Factory"],
  ["anime", "Anime", "Style Transformer"],
  ["popart", "Pop art", "Style Transformer"],
  ["neon", "Neon night", "Scene + style"],
];
const MARQUEE = ["hero", "cafe", "anime", "product", "neon", "popart", "man", "beach", "mascot", "headshot"];
const STYLE_CHIPS = ["Photoreal", "Cinematic", "Anime", "Pop art", "Watercolor", "Cyberpunk", "Pixel art", "Oil painting", "Claymation", "Film noir", "Synthwave", "Chibi"];
const STUDIO_TINTS = ["from-[#ff8a4c]/25", "from-[#ff4f7b]/25", "from-[#d14bff]/25", "from-[#ffb347]/25", "from-[#8b5cff]/25", "from-[#ff6fae]/25"];

const STEPS = [
  ["Upload once", "Add one clear photo of yourself (or someone who said yes) and save it as your Character."],
  ["Pick a tool & a vibe", "Choose from 30 tools, tap a few style chips or a saved Style board. You see the credit cost first."],
  ["Get a whole shoot", "Images arrive in parallel in your private gallery. Edit, expand, upscale or restyle any of them."],
];

const FAQ = [
  ["Will every image look exactly like me?", "No tool can guarantee that. Identity Lock improves consistency, but faces, hands, logos and text can drift. You can regenerate, and you're charged only for delivered images."],
  ["Who can see my photos?", "Only you. Uploads and results are stored privately and every download is checked against your account. Delete them any time."],
  ["Can I upload photos of other people?", "Only with their explicit permission. You confirm this on every upload. Impersonation and non-consensual imagery are prohibited."],
  ["Can I use images in ads?", "Where the image provider's terms and your rights in the inputs allow it. Ad concepts are synthetic and must not be presented as real customers or real results."],
  ["What is a credit?", "Credits are spent per delivered image. The exact cost is shown before you generate, and unused credits are returned automatically."],
];

function Photo({ name, alt, className = "", label }: { name: string; alt: string; className?: string; label?: string }) {
  return (
    <figure className={`${className.includes("absolute") ? "" : "relative "}overflow-hidden rounded-[1.6rem] shadow-2xl shadow-black/50 ring-1 ring-white/10 ${className}`}>
      <img src={S(name)} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      {label && <figcaption className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur">{label}</figcaption>}
    </figure>
  );
}

export default async function Landing() {
  const features = await listFeatures();
  const tools = features.filter((f) => f.tool_number !== null);
  return (
    <div className="overflow-x-clip">
      {/* ── Hero ── */}
      <section className="grain relative isolate">
        <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
          <div className="blob left-[-10%] top-[-10%] h-[28rem] w-[28rem] bg-[#ff7a45]" />
          <div className="blob right-[-5%] top-[10%] h-[30rem] w-[30rem] bg-[#c13cff]" style={{ animationDelay: "-6s" }} />
          <div className="blob bottom-[-15%] left-[30%] h-[26rem] w-[26rem] bg-[#ff3d7f]" style={{ animationDelay: "-12s" }} />
        </div>
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 md:grid-cols-[1.05fr_1fr] md:pt-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[#ff7a45]" /> Private beta · 30 creative tools
            </span>
            <h1 className="font-display mt-6 text-5xl font-semibold leading-[1.02] tracking-tight md:text-7xl">
              One photo.<br />
              <em className="text-sunset font-medium">Endless you.</em>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/75">
              Turn a single portrait into café mornings, sunset walks, studio headshots, anime and pop-art portraits, product shots and ad campaigns, all with the same face.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/signup" className="bg-sunset rounded-full px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#ff4f7b]/30 transition hover:brightness-110">Start free · 15 credits</Link>
              <Link href="#gallery" className="rounded-full border border-white/20 px-6 py-3.5 text-base font-medium text-white/90 hover:bg-white/10">See what it makes</Link>
            </div>
            <p className="mt-4 text-xs text-white/50">No card needed. Likeness is approximate, never guaranteed.</p>
          </div>
          <div className="relative mx-auto h-[30rem] w-full max-w-md md:h-[34rem]" aria-label="AI-generated examples of one fictional person">
            <Photo name="hero" alt="Fictional woman, original reference portrait" label="Your photo" className="absolute left-[18%] top-0 z-20 h-[72%] w-[64%] -rotate-2" />
            <Photo name="anime" alt="Same woman as an anime illustration" label="Anime" className="absolute left-0 top-[40%] z-30 h-[46%] w-[44%] -rotate-6" />
            <Photo name="popart" alt="Same woman as pop art" label="Pop art" className="absolute right-0 top-[8%] z-10 h-[40%] w-[38%] rotate-6" />
            <Photo name="cafe" alt="Same woman in a café" label="Café" className="absolute bottom-0 right-[4%] z-30 h-[44%] w-[42%] rotate-3" />
            <span className="font-display absolute -bottom-6 left-[2%] z-40 rotate-[-4deg] text-2xl italic text-white/90 drop-shadow">same face, any world ✦</span>
          </div>
        </div>
      </section>

      {/* ── Marquee ── */}
      <section aria-label="Example images" className="border-y border-white/10 bg-black/30 py-5">
        <div className="marquee gap-4">
          {[...MARQUEE, ...MARQUEE].map((n, i) => (
            <img key={`${n}-${i}`} src={S(n)} alt="" aria-hidden={i >= MARQUEE.length} loading="lazy" className="h-44 w-36 rounded-2xl object-cover ring-1 ring-white/10" />
          ))}
        </div>
      </section>

      {/* ── Same face, every story ── */}
      <section id="gallery" className="mx-auto max-w-6xl px-4 py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#ff8a4c]">Character consistency</p>
          <h2 className="font-display mt-3 text-4xl font-semibold leading-tight md:text-5xl">Same face, <em className="text-sunset">every story.</em></h2>
          <p className="mt-4 text-lg text-white/70">Every image below started from the single portrait on the left. Save your character once and reuse it in any of the 30 tools.</p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-[1fr_2fr]">
          <div className="border-sunset relative rounded-[2rem] p-2">
            <Photo name="hero" alt="Original reference portrait of a fictional woman" className="h-full min-h-[24rem]" />
            <span className="bg-sunset absolute -top-3 left-6 rounded-full px-3 py-1 text-xs font-bold text-white">1 reference photo</span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {VARIANTS.map(([n, title, tool]) => (
              <figure key={n} className="group relative aspect-[4/5] overflow-hidden rounded-[1.4rem] ring-1 ring-white/10">
                <img src={S(n)} alt={`${title}: the same fictional woman`} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                  <span className="block text-sm font-semibold text-white">{title}</span>
                  <span className="text-[11px] text-white/65">{tool}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
        <p className="mt-4 text-xs text-white/45">All images on this page are AI-generated examples. The people shown are fictional.</p>
      </section>

      {/* ── Styles ── */}
      <section className="relative isolate overflow-hidden py-24">
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-br from-[#2a0f2e] via-[#1a0f1f] to-[#2b130c]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#ff6fae]">Styles & moodboards</p>
            <h2 className="font-display mt-3 text-4xl font-semibold leading-tight md:text-5xl">Your look, <em className="text-sunset">on repeat.</em></h2>
            <p className="mt-4 text-lg text-white/70">Tap a style, or save your own Style board from images you love and apply it to anything: new shoots or pictures you made last month.</p>
            <ul className="mt-7 flex flex-wrap gap-2">
              {STYLE_CHIPS.map((c, i) => (
                <li key={c} className="rounded-full border border-white/15 px-3.5 py-1.5 text-sm text-white/85" style={{ background: `hsl(${(i * 29 + 10) % 360} 80% 60% / .12)` }}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Photo name="neon" alt="Neon night portrait" className="col-span-2 row-span-2 aspect-[4/5]" label="Cyberpunk" />
            <Photo name="anime" alt="Anime style" className="aspect-[4/5]" />
            <Photo name="popart" alt="Pop art style" className="aspect-[4/5]" />
          </div>
        </div>
      </section>

      {/* ── For brands ── */}
      <section className="mx-auto max-w-6xl px-4 py-24">
        <div className="grid items-center gap-12 md:grid-cols-[1fr_1.1fr]">
          <div className="grid grid-cols-2 gap-4">
            <Photo name="product" alt="Product photo of a serum bottle" label="Product lifestyle" className="aspect-[4/5] translate-y-6" />
            <Photo name="man" alt="Fictional man recording a podcast" label="Creator content" className="aspect-[4/5]" />
            <Photo name="mascot" alt="Original fox mascot" label="Brand mascot" className="col-span-2 aspect-[2/1]" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#ffb347]">For creators, brands & agencies</p>
            <h2 className="font-display mt-3 text-4xl font-semibold leading-tight md:text-5xl">A whole content team, <em className="text-sunset">in one studio.</em></h2>
            <p className="mt-4 text-lg text-white/70">Product photos, UGC-style ad concepts, thumbnails, mascots, storyboards and every social format from one brief. Edit, expand, upscale or restyle anything in a click.</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {STUDIOS.map((s, i) => {
                const n = features.filter((f) => f.studio === s.key).length;
                return (
                  <div key={s.key} className={`rounded-2xl border border-white/10 bg-gradient-to-br ${STUDIO_TINTS[i % STUDIO_TINTS.length]} to-transparent p-4`}>
                    <p className="font-semibold">{s.name}</p>
                    <p className="mt-1 text-xs text-white/60">{s.blurb} · {n} tools</p>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-sm text-white/50">{tools.length} tools in total. New tools start in beta.</p>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-display text-center text-4xl font-semibold md:text-5xl">Three steps to <em className="text-sunset">a full shoot</em></h2>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="border-sunset relative rounded-[1.6rem] p-7">
              <span className="font-display text-sunset text-6xl font-semibold italic">{i + 1}</span>
              <h3 className="mt-3 text-lg font-semibold">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── FAQ ── */}
      <section className="mx-auto max-w-3xl px-4 py-16">
        <h2 className="font-display text-3xl font-semibold md:text-4xl">Good questions</h2>
        <div className="mt-6 divide-y divide-white/10 rounded-[1.6rem] border border-white/10 bg-white/[0.03]">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {q}<span className="text-[#ff7a45] transition group-open:rotate-45">＋</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="px-4 py-16">
        <div className="bg-sunset grain relative mx-auto max-w-6xl overflow-hidden rounded-[2.2rem] px-8 py-16 text-center shadow-2xl shadow-[#ff4f7b]/20">
          <h2 className="font-display text-4xl font-semibold text-white md:text-6xl">Your first shoot is <em>on us.</em></h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-white/90">15 free credits. Upload one photo and see yourself in a dozen new worlds.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="rounded-full bg-white px-7 py-3.5 font-semibold text-[#c2185b] shadow-lg hover:bg-white/90">Create your account</Link>
            <ButtonLink href="/pricing" variant="secondary" className="rounded-full border-white/40 bg-white/10 px-6 py-3.5 text-white hover:bg-white/20">See pricing</ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
