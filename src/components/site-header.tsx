import Link from "next/link";
import { ButtonLink } from "./ui";

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#111113]/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="bg-sunset grid h-8 w-8 place-items-center rounded-xl text-sm font-bold text-white shadow-md shadow-[#ff4f7b]/30">AI</span>
          <span className="font-display whitespace-nowrap text-lg">Character <em className="text-sunset">Studio</em></span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          <Link href="/pricing" className="hidden rounded-lg px-3 py-2 text-muted hover:text-ink sm:block">Pricing</Link>
          <Link href="/#tools" className="hidden rounded-lg px-3 py-2 text-muted hover:text-ink sm:block">Tools</Link>
          <Link href="/#how" className="hidden rounded-lg px-3 py-2 text-muted hover:text-ink md:block">How it works</Link>
          {signedIn ? (
            <ButtonLink href="/dashboard">Open studio</ButtonLink>
          ) : (
            <>
              <Link href="/login" className="whitespace-nowrap rounded-lg px-3 py-2 text-muted hover:text-ink">Sign in</Link>
              <Link href="/signup" className="bg-sunset whitespace-nowrap rounded-full px-4 py-2 font-semibold text-white shadow-md shadow-[#ff4f7b]/25 hover:brightness-110">Start free</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({ company = "Peter Matt Apps" }: { company?: string }) {
  return (
    <footer className="mt-24 border-t border-line/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted">
        <p>© {new Date().getFullYear()} {company} · AI Character Studio. All generated images are synthetic.</p>
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
