"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fileUrl } from "@/lib/api";
import { Uploader, type AssetLite } from "./uploader";
import { Card, Notice, cx } from "./ui";

export function TextPicker({ assets, emailVerified }: { assets: AssetLite[]; emailVerified: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"created" | "uploads">(assets.some((a) => a.kind === "output") ? "created" : "uploads");
  const photos = assets.filter((a) => !a.mime?.startsWith("video/"));
  const created = photos.filter((a) => a.kind === "output");
  const uploads = photos.filter((a) => a.kind !== "output");
  const list = tab === "created" ? created : uploads;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="space-y-4">
        <div className="flex gap-2" role="tablist">
          {([["created", `Images you created (${created.length})`], ["uploads", `Your uploads (${uploads.length})`]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("rounded-full border px-3 py-1 text-sm", tab === k ? "border-accent bg-accent/15 text-accent" : "border-line text-muted")}>{label}</button>
          ))}
        </div>
        {list.length ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {list.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => router.push(`/text/${a.id}`)} className="group block w-full overflow-hidden rounded-xl border border-line text-left hover:border-accent" aria-label={`Add text to ${a.title}`}>
                  <img src={fileUrl(a.id, { thumb: true })} alt="" className="aspect-square w-full object-cover transition group-hover:scale-105" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{tab === "created" ? "No generated images yet. Create some in the Studio, or upload a photo on the right." : "No uploads yet. Upload a photo on the right."}</p>
        )}
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Upload a new photo</h2>
        {emailVerified ? (
          <Uploader kind="other" onUploaded={(a) => router.push(`/text/${a.id}`)} />
        ) : (
          <Notice tone="warn">Verify your email to upload photos.</Notice>
        )}
        <p className="text-xs text-muted">After uploading, the editor opens with your photo. Your original is never changed; saving creates a new copy in your Gallery.</p>
      </Card>
    </div>
  );
}
