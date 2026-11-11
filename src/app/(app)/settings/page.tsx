import { currentUser } from "@/server/http";
import { q } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { SettingsForms } from "./settings-forms";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const user = (await currentUser())!;
  const receipts = await q<{ id: string; subject: string; statement_version: string; created_at: Date }>(
    `SELECT id, subject, statement_version, created_at FROM consent_receipts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [user.id],
  );
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" />
      <SettingsForms displayName={user.displayName} email={user.email} receipts={receipts.map((r) => ({ ...r, created_at: r.created_at.toISOString() }))} />
    </div>
  );
}
