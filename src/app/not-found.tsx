import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <Link href="/" className="mt-4 inline-block text-accent">Go home</Link>
      </div>
    </main>
  );
}
