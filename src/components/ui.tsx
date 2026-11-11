import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";
const btn: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 font-semibold",
  secondary: "bg-surface-2 text-ink border border-line hover:border-muted",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  danger: "bg-bad/15 text-bad border border-bad/40 hover:bg-bad/25",
};

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button {...p} className={cx("inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50", btn[variant], className)} />;
}

export function ButtonLink({ variant = "primary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...p} className={cx("inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition", btn[variant], className)} />;
}

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div {...p} className={cx("rounded-2xl border border-line bg-surface p-5", className)} />;
}

const badge: Record<string, string> = {
  live: "bg-ok/15 text-ok border-ok/30",
  beta: "bg-accent/15 text-accent border-accent/30",
  coming_soon: "bg-warn/10 text-warn border-warn/30",
  planned: "bg-surface-2 text-muted border-line",
  paused: "bg-bad/10 text-bad border-bad/30",
  neutral: "bg-surface-2 text-muted border-line",
};
const label: Record<string, string> = { live: "Live", beta: "Beta", coming_soon: "Coming soon", planned: "Planned", paused: "Paused" };

export function Badge({ tone = "neutral", children }: { tone?: string; children?: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", badge[tone] ?? badge.neutral)}>{children ?? label[tone] ?? tone}</span>;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputCls = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none";

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const t = { info: "border-line bg-surface-2 text-muted", warn: "border-warn/30 bg-warn/10 text-warn", error: "border-bad/40 bg-bad/10 text-bad", ok: "border-ok/30 bg-ok/10 text-ok" }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-lg border px-3 py-2 text-sm", t)}>{children}</div>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

export const fmtUsd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 ? 2 : 0 });
export { cx };
