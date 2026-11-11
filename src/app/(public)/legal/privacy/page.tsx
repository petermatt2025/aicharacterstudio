export const metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <article className="prose-legal mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-semibold">Privacy policy</h1>
      <p className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">Template for owner review. This text must be reviewed by qualified counsel before public launch and does not constitute legal advice.</p>
      <h2>What we collect</h2>
      <ul><li>Account data: email, display name, hashed password.</li><li>Images you upload and images generated for you. These may include faces and are treated as sensitive.</li><li>Consent records you confirm on upload.</li><li>Usage, billing and security logs (no image content).</li></ul>
      <h2>How we use it</h2>
      <p>To provide the service: storing your private library, sending your inputs to our image-generation provider to create the images you request, billing, abuse prevention and support. We do not sell personal data and do not train our own models on your photos without separate, explicit opt-in.</p>
      <h2>Processors</h2>
      <p>[Owner to list: hosting, database/storage, image model provider (e.g. OpenAI), Stripe for payments, email provider.] International transfers rely on [owner to specify safeguards].</p>
      <h2>Biometric data</h2>
      <p>We do not build face templates or perform face recognition. Images are processed only to generate the content you request.</p>
      <h2>Retention and deletion</h2>
      <p>You can delete any image at any time, and delete your account from Settings. Account deletion removes stored images and anonymizes your account. Accounting records are retained as required by law.</p>
      <h2>Your rights</h2>
      <p>Depending on your location (including under the GDPR), you may access, correct, delete or export your data and object to processing. Contact [support email].</p>
      <h2>Controller</h2>
      <p>[Legal entity name, address, tax residence, contact details.]</p>
    </article>
  );
}
