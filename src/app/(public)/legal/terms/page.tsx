export const metadata = { title: "Terms" };

export default function Terms() {
  return (
    <article className="prose-legal mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-semibold">Terms of service</h1>
      <p className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">Template for owner review. This text must be reviewed by qualified counsel before public launch and does not constitute legal advice.</p>
      <h2>The service</h2>
      <p>AI Character Studio generates synthetic images from your inputs using third-party AI models. Results vary. Likeness, anatomy, products, logos and text are not guaranteed to be accurate.</p>
      <h2>Your content and rights</h2>
      <p>You must own or have permission to use everything you upload, including the explicit consent of any identifiable person. You remain responsible for how you use outputs. Commercial use is permitted only to the extent allowed by the model provider&apos;s terms and your rights in the inputs. We do not guarantee ownership or exclusivity of generated images.</p>
      <h2>Credits and billing</h2>
      <p>Credits have no cash value. Plan credits expire at the end of each billing period; top-up credits expire 12 months after purchase. Charges are processed by Stripe. Refunds follow [owner refund policy] and refunded top-ups revoke unspent credits.</p>
      <h2>Acceptable use</h2>
      <p>Use must comply with the <a href="/legal/acceptable-use" className="text-accent">Acceptable Use Policy</a>. We may suspend accounts that violate it.</p>
      <h2>Liability</h2>
      <p>[Owner/counsel to complete: disclaimers, limitation of liability, governing law, dispute resolution.]</p>
    </article>
  );
}
