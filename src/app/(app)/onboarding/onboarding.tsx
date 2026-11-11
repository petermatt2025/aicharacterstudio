"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Uploader, type AssetLite } from "@/components/uploader";
import { Button, Card, Field, Notice, PageHeader, inputCls } from "@/components/ui";
import { VerifyBanner } from "@/components/verify-banner";

export function Onboarding({ emailVerified, hasCharacter }: { emailVerified: boolean; hasCharacter: boolean }) {
  const router = useRouter();
  const [asset, setAsset] = useState<AssetLite | null>(null);
  const [name, setName] = useState("Me");
  const [error, setError] = useState<string | null>(null);

  async function finish(createChar: boolean) {
    setError(null);
    try {
      if (createChar && asset) await api("/api/characters", { body: { name, assetIds: [asset.id] } });
      await api("/api/me/onboarding", { method: "POST" });
      router.push(createChar ? "/studio" : "/dashboard");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Let's set up your first character" sub="Two minutes. You can skip and do this later." />
      {!emailVerified && <VerifyBanner />}
      <Card className="space-y-3">
        <h2 className="font-semibold">How we treat your photos</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Only upload photos of yourself, or of people who explicitly agreed.</li>
          <li>Photos are private, stripped of location data, and can be deleted any time.</li>
          <li>We never use them to train our own models.</li>
          <li>Generated likeness is approximate; you can regenerate any image.</li>
        </ul>
      </Card>
      {emailVerified && !hasCharacter && (
        <Card className="space-y-4">
          <h2 className="font-semibold">Upload a clear portrait</h2>
          <p className="text-sm text-muted">Face the camera, good light, no sunglasses. One photo is enough to start.</p>
          {asset ? (
            <>
              <img src={`/api/assets/${asset.id}/file?variant=thumb`} alt="Your portrait" className="h-40 w-40 rounded-xl object-cover" />
              <Field label="Character name" htmlFor="cname"><input id="cname" className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
              <Button onClick={() => finish(true)} disabled={!name.trim()}>Save character and open the studio</Button>
            </>
          ) : (
            <Uploader kind="character" onUploaded={setAsset} />
          )}
        </Card>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="ghost" onClick={() => finish(false)}>{hasCharacter ? "Go to dashboard" : "Skip for now"}</Button>
    </div>
  );
}
