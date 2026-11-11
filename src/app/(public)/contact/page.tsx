import { Card } from "@/components/ui";

export const metadata = { title: "Contact" };

export default function Contact() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14">
      <h1 className="text-3xl font-semibold">Contact</h1>
      <Card className="mt-6 space-y-3 text-sm text-muted">
        <p>Support: <span className="text-ink">[support email, to be set by owner]</span></p>
        <p>Privacy and data requests: <span className="text-ink">[privacy email]</span></p>
        <p>Abuse reports (including images of you uploaded without consent): <span className="text-ink">[abuse email]</span></p>
        <p>Company: <span className="text-ink">[legal entity name and address]</span></p>
      </Card>
    </div>
  );
}
