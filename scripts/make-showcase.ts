// Generates the landing-page showcase images with the REAL OpenAI provider (fictional people only).
// One fictional character is created, then re-used as the reference for several scenes and styles,
// demonstrating character consistency. Output: public/showcase/*.webp. Skips files that already exist.
// Usage: set -a; . ./.env.local; set +a; npx tsx --conditions=react-server scripts/make-showcase.ts
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { OpenAIImageProvider } from "../src/server/providers/openai";
import { env } from "../src/server/env";
import type { AspectRatio } from "../src/server/providers/types";

const OUT = path.join(process.cwd(), "public", "showcase");
fs.mkdirSync(OUT, { recursive: true });
const e = env();
const provider = new OpenAIImageProvider({ apiKey: e.OPENAI_API_KEY!, model: e.OPENAI_IMAGE_MODEL, timeoutMs: 240_000, stream: e.OPENAI_IMAGE_STREAM });
const FICTIONAL = "A fictional person, not a real individual. No text, no logos, no watermark.";

type Job = { name: string; prompt: string; aspect: AspectRatio; ref?: "hero" };
const KEEP = "Keep exactly the same woman from the reference image: same face, eyes, curly dark-auburn hair and skin tone.";
const jobs: Job[] = [
  { name: "hero", aspect: "4:5", prompt: `Vibrant editorial portrait of a fictional woman in her late 20s with voluminous curly dark-auburn hair and warm brown skin, smiling confidently, wearing a mustard-yellow blazer, standing against a bold coral-to-violet gradient backdrop, colorful rim light. ${FICTIONAL}` },
  { name: "cafe", aspect: "4:5", ref: "hero", prompt: `${KEEP} She sits by the window of a cozy café at golden hour, laughing, latte on the table, warm sunlight. Photorealistic lifestyle photo. ${FICTIONAL}` },
  { name: "beach", aspect: "4:5", ref: "hero", prompt: `${KEEP} She walks on a beach at sunset in a flowing white linen dress, hair blowing, pink and orange sky. Cinematic photo. ${FICTIONAL}` },
  { name: "headshot", aspect: "4:5", ref: "hero", prompt: `${KEEP} Professional corporate headshot, navy blazer, light-grey studio backdrop, soft key light, friendly expression. ${FICTIONAL}` },
  { name: "anime", aspect: "4:5", ref: "hero", prompt: `${KEEP} Re-render her as a high-quality anime illustration, clean line art, cel shading, cherry blossoms, vibrant colors. ${FICTIONAL}` },
  { name: "popart", aspect: "4:5", ref: "hero", prompt: `${KEEP} Re-render her as bold pop art: flat bright colors, halftone dots, thick black outlines, magenta and yellow background. ${FICTIONAL}` },
  { name: "neon", aspect: "4:5", ref: "hero", prompt: `${KEEP} Night portrait on a rainy city street with neon magenta and cyan signs reflecting, cyberpunk mood, cinematic. ${FICTIONAL}` },
  { name: "product", aspect: "4:5", prompt: `Luxury product photo of an unbranded amber glass serum bottle with a gold dropper on a pink stone podium, soft shadows, coral and peach backdrop, fresh flowers. No text, no logos.` },
  { name: "man", aspect: "4:5", prompt: `Lifestyle photo of a fictional man in his 40s with a short grey beard, laughing while recording a podcast with a microphone and headphones, warm colorful studio lights. ${FICTIONAL}` },
  { name: "mascot", aspect: "1:1", prompt: `Original 3D cartoon brand mascot: a cheerful round orange fox wearing a teal hoodie, waving, soft studio lighting, pastel coral background. Original character. No text.` },
];

async function save(name: string, bytes: Buffer) {
  await sharp(bytes).resize({ width: 960, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(OUT, `${name}.webp`));
}

async function run(job: Job, heroBytes?: Buffer) {
  const file = path.join(OUT, `${job.name}.webp`);
  if (fs.existsSync(file)) return console.log(`skip ${job.name}`);
  const t0 = Date.now();
  const res = await provider.generate({
    userId: "showcase", workspaceId: "showcase", featureKey: "showcase", prompt: job.prompt, references: [],
    referenceImages: job.ref && heroBytes ? [{ role: "character", bytes: heroBytes, mime: "image/png" }] : [],
    requestedOutputs: 1, aspectRatio: job.aspect, quality: "standard",
  });
  await save(job.name, res.outputs[0]!.bytes);
  if (job.name === "hero") fs.writeFileSync(path.join(OUT, ".hero.png"), res.outputs[0]!.bytes);
  console.log(`done ${job.name} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

async function main() {
  await run(jobs[0]!);
  const heroPath = path.join(OUT, ".hero.png");
  const hero = fs.existsSync(heroPath) ? fs.readFileSync(heroPath) : await sharp(path.join(OUT, "hero.webp")).png().toBuffer();
  const rest = jobs.slice(1);
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < rest.length) {
      const j = rest[i++]!;
      try { await run(j, hero); } catch (err) { console.log(`FAILED ${j.name}: ${(err as Error).message}`); }
    }
  }));
}
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
