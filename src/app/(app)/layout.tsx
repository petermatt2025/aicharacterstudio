import { redirect } from "next/navigation";
import { currentUser } from "@/server/http";
import { getBalance } from "@/server/credits";
import { AppNav } from "@/components/app-nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const credits = await getBalance(user.workspaceId);
  return (
    <div className="min-h-screen md:flex">
      <AppNav user={{ email: user.email, planKey: user.planKey, isAdmin: user.isAdmin, emailVerified: user.emailVerified }} credits={credits.balance} />
      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
