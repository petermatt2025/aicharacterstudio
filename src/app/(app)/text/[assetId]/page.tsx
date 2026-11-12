import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/montserrat/index.css";
import "@fontsource-variable/oswald/index.css";
import "@fontsource-variable/playfair-display/index.css";
import "@fontsource-variable/playfair-display/wght-italic.css";
import "@fontsource-variable/fraunces/index.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource/anton/index.css";
import "@fontsource/bebas-neue/index.css";
import "@fontsource/pacifico/index.css";
import "@fontsource/lobster/index.css";
import "@fontsource/permanent-marker/index.css";
import "@fontsource/caveat/700.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/server/http";
import { getAsset } from "@/server/assets";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/ui";
import { TextStudio } from "@/components/text-studio";

export default async function TextPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const user = (await currentUser())!;
  const a = await getAsset(user, assetId).catch((e) => (e instanceof AppError ? null : Promise.reject(e)));
  if (!a) notFound();
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Text Studio" sub="Add exact, editable text to any image. Free, instant, and your original is kept." actions={<Link href="/gallery" className="text-sm text-muted hover:text-ink">← Gallery</Link>} />
      <TextStudio assetId={a.id} width={a.width} height={a.height} title={a.title} />
    </div>
  );
}
