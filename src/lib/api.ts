"use client";

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; details?: unknown } }).error;
    throw new ApiError(e?.code ?? "internal", e?.message ?? `Request failed (${res.status})`, res.status, e?.details);
  }
  return data as T;
}

export const fileUrl = (id: string, opts: { thumb?: boolean; download?: boolean } = {}) =>
  `/api/assets/${id}/file?${new URLSearchParams({ ...(opts.thumb ? { variant: "thumb" } : {}), ...(opts.download ? { download: "1" } : {}) })}`;
