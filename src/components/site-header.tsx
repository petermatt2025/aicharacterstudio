import Link from "next/link";
import { ButtonLink } from "./ui";

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="border-b border-line/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-ink">AI</span>
          Character Studio
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          <Link href="/pricing" className="rounded-lg px-3 py-2 text-muted hover:text-ink">Pricing</Link>
          <Link href="/#how" className="hidden rounded-lg px-3 py-2 text-muted hover:text-ink sm:block">How it works</Link>
          {signedIn ? (
            <ButtonLink href="/dashboard">Open studio</ButtonLink>
          ) : (
            <>
              <Link href="/login" className="rounded-lg px-3 py-2 text-muted hover:text-ink">Sign in</Link>
              <ButtonLink href="/signup">Start free</ButtonLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted">
        <p>© {new Date().getFullYear()} AI Character Studio. All generated images are synthetic.</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-4">
          <Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/legal/terms" className="hover:text-ink">Terms</Link>
          <Link href="/legal/acceptable-use" className="hover:text-ink">Acceptable use</Link>
          <Link href="/contact" className="hover:text-ink">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}
