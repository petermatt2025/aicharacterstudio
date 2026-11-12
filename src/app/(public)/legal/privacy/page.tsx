import { env } from "@/server/env";

export const metadata = { title: "Privacy" };

export default function Privacy() {
  const e = env();
  const mail = e.SUPPORT_EMAIL;
  return (
    <article className="prose-legal mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-semibold">Privacy policy</h1>
      <p className="text-sm text-muted">Last updated: 12 November 2026</p>

      <h2>Who is responsible</h2>
      <p>The data controller is {e.BUSINESS_NAME}, {e.BUSINESS_ADDRESS ? `${e.BUSINESS_ADDRESS}, ` : ""}{e.BUSINESS_COUNTRY}. For any privacy question or request, email <a className="text-accent" href={`mailto:${mail}`}>{mail}</a>.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Account data:</b> email address, display name and a securely hashed password.</li>
        <li><b>Your images:</b> photos you upload and the images created for you. These can show faces, so we treat them as sensitive and keep them private to your account.</li>
        <li><b>Consent records:</b> the rights and consent confirmations you give when uploading.</li>
        <li><b>Billing data:</b> plan, invoices and payment status. Card details are handled by Stripe; we never see or store your full card number.</li>
        <li><b>Usage and security logs:</b> actions such as generations and sign-ins, without image content.</li>
      </ul>

      <h2>Why we use it (legal bases)</h2>
      <ul>
        <li>To provide the service you signed up for: storing your private library, sending your inputs to the AI provider to create the images you request, and billing (performance of a contract).</li>
        <li>To keep the service safe: preventing abuse and fraud, and moderating content (legitimate interests).</li>
        <li>To meet legal obligations such as tax and accounting.</li>
      </ul>
      <p>We do not sell personal data, do not show third-party advertising and do not train our own AI models on your photos.</p>

      <h2>Faces and biometric data</h2>
      <p>We do not create face templates and do not perform face recognition or identification. Your images are processed only to generate the content you ask for.</p>

      <h2>Who processes data for us</h2>
      <ul>
        <li>Railway: hosting, database and file storage.</li>
        <li>OpenAI and Google (Gemini): image generation and automated content moderation.</li>
        <li>Stripe: payments and invoicing.</li>
        <li>Resend: account emails such as verification and password reset.</li>
      </ul>
      <p>Some of these providers process data outside the European Economic Area, mainly in the United States. Such transfers rely on the EU-US Data Privacy Framework where the provider is certified, or on the European Commission&apos;s Standard Contractual Clauses.</p>

      <h2>How long we keep it</h2>
      <p>You can delete any image at any time, and delete your whole account in Settings. Deleting your account removes your stored images and anonymises your account. Billing records are kept for as long as tax law requires (in Portugal, generally 10 years). Security logs are kept for a limited period.</p>

      <h2>Cookies</h2>
      <p>We use one essential cookie to keep you signed in. We do not use advertising or tracking cookies.</p>

      <h2>Your rights</h2>
      <p>Under the GDPR you can request access to, correction, deletion or export of your data, and object to or restrict processing. Email <a className="text-accent" href={`mailto:${mail}`}>{mail}</a> and we will reply within one month. You can also complain to the Portuguese data protection authority, CNPD (<a className="text-accent" href="https://www.cnpd.pt" rel="noreferrer" target="_blank">cnpd.pt</a>), or the authority where you live.</p>

      <h2>Age</h2>
      <p>The service is for adults (18+). We do not knowingly process data of children.</p>
    </article>
  );
}
