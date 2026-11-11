export const metadata = { title: "Acceptable use" };

export default function AcceptableUse() {
  return (
    <article className="prose-legal mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-semibold">Acceptable use policy</h1>
      <p className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">Template for owner review. This text must be reviewed by qualified counsel before public launch and does not constitute legal advice.</p>
      <h2>Never allowed</h2>
      <ul>
        <li>Sexual or intimate imagery of real people, and any sexual content involving minors.</li>
        <li>Uploading or transforming photos of people without their explicit permission.</li>
        <li>Impersonation intended to deceive, including fake endorsements by real people or brands.</li>
        <li>Presenting synthetic images as real customer testimonials, real product results or real events.</li>
        <li>Harassment, hate, graphic violence, or content illegal where you or the subject live.</li>
        <li>Attempts to bypass moderation, rate limits, credit limits or account restrictions.</li>
      </ul>
      <h2>Advertising use</h2>
      <p>UGC and ad concepts are illustrative. Label synthetic content where law or platform rules require, and never make product claims the image could imply but you cannot substantiate.</p>
      <h2>Enforcement</h2>
      <p>Inputs and outputs are checked by automated moderation. Violations may lead to blocked requests, removal of content, and account suspension. Report abuse to [support email].</p>
    </article>
  );
}
