import "server-only";
import crypto from "node:crypto";
import sharp from "sharp";
import { ProviderError } from "./types";
import type { VideoProvider, VideoRequest, VideoResult } from "./video";

/**
 * Kling AI image-to-video (official API). Auth is a short-lived HS256 JWT signed with the account's
 * Access Key (iss) and Secret Key. The output follows the input image's shape, so the photo is first
 * cropped to the requested aspect ratio.
 */
export function klingToken(accessKey: string, secretKey: string, now = Math.floor(Date.now() / 1000)): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ iss: accessKey, exp: now + 1800, nbf: now - 5 });
  const sig = crypto.createHmac("sha256", secretKey).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

type KlingTask = { code: number; message?: string; data?: { task_id?: string; task_status?: string; task_status_msg?: string; task_result?: { videos?: Array<{ url?: string }> } } };

export function mapKlingError(httpStatus: number, code: number | undefined, message: string): ProviderError {
  const m = `${message}`.slice(0, 250);
  // Kling business codes: 1000-1004 auth, 1100-1103 account/balance, 1300-1301 policy/content, 1302-1304 rate/concurrency, 5000+ server.
  if (httpStatus === 401 || (code !== undefined && code >= 1000 && code <= 1004)) return new ProviderError("auth", `Kling rejected the API keys: ${m}`);
  if (code !== undefined && code >= 1100 && code <= 1103) return new ProviderError("auth", `Kling account problem (balance or access): ${m}`);
  if (code === 1301 || /content security|sensitive|risk/i.test(m)) return new ProviderError("moderation", "Kling's safety system blocked this video");
  if (httpStatus === 429 || (code !== undefined && code >= 1302 && code <= 1304)) return new ProviderError("rate_limit", "Kling is busy; retrying");
  if (httpStatus >= 500 || (code !== undefined && code >= 5000)) return new ProviderError("transient", `Kling server error: ${m}`);
  return new ProviderError("invalid_request", `Kling rejected the request: ${m}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class KlingVideoProvider implements VideoProvider {
  readonly name = "kling";
  readonly model: string;
  constructor(private opts: { accessKey: string; secretKey: string; model: string; mode: "std" | "pro"; baseUrl?: string; fetch?: typeof fetch; pollMs?: number; timeoutMs?: number }) {
    this.model = opts.model;
  }
  private base() {
    return this.opts.baseUrl ?? "https://api-singapore.klingai.com";
  }
  private async call(path: string, init: RequestInit = {}): Promise<KlingTask> {
    const f = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.base()}${path}`, {
        ...init,
        headers: { "content-type": "application/json", authorization: `Bearer ${klingToken(this.opts.accessKey, this.opts.secretKey)}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new ProviderError("transient", "Could not reach Kling");
    }
    const json = (await res.json().catch(() => ({}))) as KlingTask;
    if (!res.ok || (json.code !== undefined && json.code !== 0)) throw mapKlingError(res.status, json.code, json.message ?? `HTTP ${res.status}`);
    return json;
  }

  async generate(req: VideoRequest): Promise<VideoResult> {
    // Crop to the requested shape (Kling keeps the input image's aspect ratio).
    const [tw, th] = req.aspectRatio === "16:9" ? [1280, 720] : [720, 1280];
    const image = await sharp(req.image.bytes).rotate().resize(tw, th, { fit: "cover", position: "attention" }).jpeg({ quality: 92 }).toBuffer();
    const created = await this.call("/v1/videos/image2video", {
      method: "POST",
      body: JSON.stringify({
        model_name: this.model,
        mode: this.opts.mode,
        duration: req.seconds >= 8 ? "10" : "5",
        image: image.toString("base64"),
        prompt: req.prompt.slice(0, 2400),
        negative_prompt: "distorted face, extra fingers, warped hands, flicker, text, watermark",
      }),
    });
    const id = created.data?.task_id;
    if (!id) throw new ProviderError("transient", "Kling did not return a task id");
    const deadline = Date.now() + (this.opts.timeoutMs ?? 10 * 60_000);
    for (;;) {
      if (Date.now() > deadline) throw new ProviderError("timeout", "Kling took too long to make the video");
      if (req.onWait && !(await req.onWait())) throw new ProviderError("transient", "Job lease lost while waiting for the video");
      await sleep(this.opts.pollMs ?? 8_000);
      const t = await this.call(`/v1/videos/image2video/${encodeURIComponent(id)}`);
      const st = t.data?.task_status;
      if (st === "succeed") {
        const url = t.data?.task_result?.videos?.[0]?.url;
        if (!url) throw new ProviderError("transient", "Kling finished without a video");
        const r = await (this.opts.fetch ?? fetch)(url, { signal: AbortSignal.timeout(120_000) });
        if (!r.ok) throw new ProviderError("transient", `Video download failed (HTTP ${r.status})`);
        return { bytes: Buffer.from(await r.arrayBuffer()), mime: "video/mp4", provider: this.name, model: this.model, width: tw, height: th };
      }
      if (st === "failed") {
        const msg = t.data?.task_status_msg ?? "failed";
        throw /security|sensitive|risk|policy/i.test(msg) ? new ProviderError("moderation", "Kling's safety system blocked this video") : new ProviderError("invalid_request", `Kling could not make the video: ${msg.slice(0, 200)}`);
      }
    }
  }

  /** Status check: are the keys accepted? (lists the most recent task) */
  async check(): Promise<string> {
    await this.call("/v1/videos/image2video?pageNum=1&pageSize=1");
    return "keys accepted";
  }
}
