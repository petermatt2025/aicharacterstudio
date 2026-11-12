import { Card } from "@/components/ui";
import { env } from "@/server/env";

export const metadata = { title: "Contact" };

export default function Contact() {
  const e = env();
  const mail = e.SUPPORT_EMAIL;
  const link = <a className="text-accent" href={`mailto:${mail}`}>{mail}</a>;
  return (
    <div className="mx-auto max-w-2xl px-4 py-14">
      <h1 className="text-3xl font-semibold">Contact</h1>
      <Card className="mt-6 space-y-3 text-sm text-muted">
        <p>Support and billing: <span className="text-ink">{link}</span></p>
        <p>Privacy and data requests: <span className="text-ink">{link}</span></p>
        <p>Abuse reports (including images of you uploaded without your consent): <span className="text-ink">{link}</span>. We act on these with priority.</p>
        <p>Company: <span className="text-ink">{e.BUSINESS_NAME}, {e.BUSINESS_ADDRESS ? `${e.BUSINESS_ADDRESS}, ` : ""}{e.BUSINESS_COUNTRY}</span></p>
        <p>Complaints: <a className="text-accent" href="https://www.livroreclamacoes.pt" target="_blank" rel="noreferrer">Livro de Reclamações</a></p>
      </Card>
    </div>
  );
}
