import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 font-semibold">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-ink">AI</span>
          Character Studio
        </Link>
        {children}
      </div>
    </main>
  );
}
