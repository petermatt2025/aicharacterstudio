"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { cx } from "./ui";

const LINKS = [
  ["/dashboard", "Dashboard"],
  ["/studio", "Studio"],
  ["/library", "Library"],
  ["/gallery", "Gallery"],
  ["/campaigns", "Campaigns"],
  ["/billing", "Billing"],
  ["/settings", "Settings"],
] as const;

export function AppNav({ user, credits }: { user: { email: string; planKey: string; isAdmin: boolean; emailVerified: boolean }; credits: number }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const links = user.isAdmin ? [...LINKS, ["/admin", "Admin"] as const] : LINKS;
  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/");
    router.refresh();
  }
  return (
    <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
      <div className="flex items-center justify-between px-4 py-4">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-ink">AI</span>
          Studio
        </Link>
        <button className="rounded-lg px-2 py-1 text-sm text-muted md:hidden" aria-expanded={open} aria-controls="app-links" onClick={() => setOpen(!open)}>Menu</button>
      </div>
      <div id="app-links" className={cx("px-3 pb-4 md:block", open ? "block" : "hidden")}>
        <Link href="/billing" className="mb-4 block rounded-xl border border-line bg-bg p-3">
          <span className="block text-xs text-muted">Credits available</span>
          <span className="text-xl font-semibold" data-testid="nav-credits">{credits.toLocaleString()}</span>
          <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-xs capitalize text-muted">{user.planKey}</span>
        </Link>
        <nav aria-label="App">
          <ul className="space-y-0.5">
            {links.map(([href, label]) => (
              <li key={href}>
                <Link href={href} aria-current={path.startsWith(href) ? "page" : undefined} className={cx("block rounded-lg px-3 py-2 text-sm", path.startsWith(href) ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")} onClick={() => setOpen(false)}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-6 border-t border-line pt-4 text-xs text-muted">
          <p className="truncate" title={user.email}>{user.email}</p>
          <button onClick={logout} className="mt-2 text-muted hover:text-ink">Sign out</button>
        </div>
      </div>
    </aside>
  );
}
