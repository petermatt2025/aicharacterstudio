import { SiteFooter, SiteHeader } from "@/components/site-header";
import { currentUser } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  return (
    <>
      <SiteHeader signedIn={!!u} />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
