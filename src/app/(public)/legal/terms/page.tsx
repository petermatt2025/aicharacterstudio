import { env } from "@/server/env";

export const metadata = { title: "Terms" };

export default function Terms() {
  const e = env();
  const company = e.BUSINESS_NAME;
  const mail = e.SUPPORT_EMAIL;
  return (
    <article className="prose-legal mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-semibold">Terms of service</h1>
      <p className="text-sm text-muted">Last updated: 12 November 2026</p>

      <h2>1. Who we are</h2>
      <p>{e.APP_NAME} (&ldquo;the service&rdquo;) is provided by {company}, {e.BUSINESS_ADDRESS ? `${e.BUSINESS_ADDRESS}, ` : ""}{e.BUSINESS_COUNTRY} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). Contact: <a className="text-accent" href={`mailto:${mail}`}>{mail}</a>.</p>

      <h2>2. The service</h2>
      <p>The service creates synthetic (AI-generated) images from the photos, products and instructions you provide, using third-party AI models (currently OpenAI and Google Gemini). Results vary: likeness, anatomy, products, logos and text are not guaranteed to be accurate, and images may need to be regenerated.</p>

      <h2>3. Your account</h2>
      <p>You must be at least 18 years old and give accurate information. Keep your password safe; you are responsible for activity on your account.</p>

      <h2>4. Your content and rights</h2>
      <p>You may only upload images you own or have permission to use, including the explicit consent of every identifiable person shown. You keep the rights you have in your uploads and you are responsible for how you use the images you create. Commercial use is allowed to the extent permitted by the AI providers&apos; terms and your rights in the inputs. We do not guarantee that generated images are unique or protected by copyright.</p>
      <p>You give us a limited licence to store and process your content only to provide the service to you. We do not use your photos to train our own models.</p>

      <h2>5. Plans, credits and payment</h2>
      <ul>
        <li>Paid plans are subscriptions billed monthly or yearly in advance through Stripe and renew automatically until cancelled. You can cancel at any time in Billing → Manage billing; your plan stays active until the end of the paid period.</li>
        <li>Prices are shown on the pricing page. Applicable taxes (such as VAT) are calculated at checkout based on your location.</li>
        <li>Credits are used for each delivered image. The cost is shown before you generate, and credits for images that fail are returned automatically. Credits have no cash value and are not transferable.</li>
        <li>Plan credits expire at the end of each billing period. Purchased top-up credits expire 12 months after purchase. Free trial credits expire after 30 days and are given once per person.</li>
        <li>When you upgrade, you pay the prorated difference immediately and receive the additional credits. When you downgrade, unused time is credited on your next invoice.</li>
      </ul>

      <h2>6. Right of withdrawal (EU/UK consumers)</h2>
      <p>If you are a consumer in the EU or UK, you may withdraw from a purchase within 14 days without giving a reason by emailing <a className="text-accent" href={`mailto:${mail}`}>{mail}</a>. Because the service is digital and starts immediately, by using credits from a purchase you request that the service begin during the withdrawal period and acknowledge that the right of withdrawal is lost for the part already supplied. If you withdraw within 14 days, we refund the unused part of the purchase. Refunded credits are removed from your account.</p>

      <h2>7. Refunds</h2>
      <p>Apart from the right of withdrawal above and rights you have by law, payments are non-refundable, including for partially used periods. If something went wrong, contact us and we will look at it fairly.</p>

      <h2>8. Acceptable use</h2>
      <p>Your use must follow the <a href="/legal/acceptable-use" className="text-accent">Acceptable Use Policy</a>. We may block content, refuse requests and suspend or close accounts that break it, without refund where the breach is serious.</p>

      <h2>9. Availability and changes</h2>
      <p>We work to keep the service available but do not guarantee uninterrupted operation. Tools marked &ldquo;beta&rdquo; may change. We may update these terms; for material changes we will notify you in advance, and you may cancel before they apply.</p>

      <h2>10. Liability</h2>
      <p>The service is provided &ldquo;as is&rdquo;. To the extent permitted by law, our total liability for any claim is limited to the amount you paid us in the 12 months before the claim, and we are not liable for indirect or consequential losses. Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, for wilful misconduct or gross negligence, or your mandatory rights as a consumer.</p>

      <h2>11. Law and disputes</h2>
      <p>These terms are governed by Portuguese law. If you are a consumer, you also keep the protection of the mandatory laws of the country where you live. Before going to court, please contact us so we can try to resolve the issue. Consumers in Portugal may also use a consumer arbitration centre such as CNIACC (<a className="text-accent" href="https://www.cniacc.pt" rel="noreferrer" target="_blank">cniacc.pt</a>) and the electronic complaints book (<a className="text-accent" href="https://www.livroreclamacoes.pt" rel="noreferrer" target="_blank">livroreclamacoes.pt</a>).</p>
    </article>
  );
}
