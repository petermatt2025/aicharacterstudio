# AI Character Studio

Cloud SaaS for AI image creation from reusable, consented references: character angles, new environments, multi-reference mixing, UGC ad concepts and one-click photoshoots, with a private library, an atomic credit ledger and Stripe billing.

**Status:** Phase 0 + Phase 1 built and tested against a fake image provider and a Stripe mock. Live OpenAI generation and real Stripe test-mode checkout still need credentials (see *Going live with real services*). See `docs/PROGRESS.md`.

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · PostgreSQL 16 (`pg`, SQL migrations) · Postgres-backed job queue + separate worker · OpenAI Images API (`gpt-image-2`) behind an `ImageProvider` adapter · Stripe Checkout/Portal/webhooks · S3-compatible private storage (Supabase Storage, R2, S3) · Vitest + Playwright.

## Local setup
```bash
cp .env.example .env.local          # then edit
createdb acs_dev && createdb acs_test
npm install
npm run db:migrate && npm run db:seed
npm run dev                          # http://localhost:3000
npm run worker                       # second terminal: processes generation jobs
```
Without an OpenAI key you can explore the UI with `IMAGE_PROVIDER=fake` and `MODERATION_PROVIDER=baseline` (dev only; produces "TEST IMAGE" placeholders). Verification emails print to the terminal (`EMAIL_TRANSPORT=console`).

Phase-1 tools ship as **beta**: grant yourself access with `npm run admin:grant -- you@example.com`, then use `/admin` to manage feature states, credit rules and the kill switch.

## Tests
```bash
npm run check                        # lint + typecheck + 67 unit/integration tests (real Postgres)
npm run build && npm run test:e2e    # browser e2e of the Phase-1 gate (screenshots in test-results/e2e)
```

## Going live with real services (owner action required)
1. **OpenAI**: set `OPENAI_API_KEY`, keep `IMAGE_PROVIDER=openai`, `MODERATION_PROVIDER=openai`. Fill the `OPENAI_IMAGE_*_USD_PER_MTOK` rates from the pricing page so cost reports are real. Run one generation per tool, then flip tools to `live` in `/admin`.
2. **Stripe (test mode)**: create Products/Prices for Creator/Pro/Agency (monthly+annual) and the three top-up packs; put the Price IDs in env and run `npm run db:seed`. Configure the Billing Portal to allow plan switching (downgrades at period end). Forward webhooks:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   Subscribe to: `checkout.session.completed`, `customer.subscription.created|updated|deleted|paused|resumed`, `invoice.paid`, `invoice.payment_failed`, `payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created`.
   Live keys are refused unless `STRIPE_ALLOW_LIVE_MODE=true`, which requires the owner's approval.
3. **Storage**: create a *private* bucket (Supabase Storage S3 endpoint, R2 or S3) and set `STORAGE_DRIVER=s3` + `S3_*`.
4. **Email**: `EMAIL_TRANSPORT=resend` + `RESEND_API_KEY` + a verified sender domain.

## Staging deployment (not performed)
- Web: Vercel (or any Node host) running `npm run build && npm start` with `APP_ENV=staging`.
- Worker: a long-running Node process (`npm run worker`) on Fly.io/Render/Railway/a VM, with the same env. Do not run it inside serverless functions.
- Database: managed Postgres (Supabase works as plain Postgres); run `npm run db:migrate && npm run db:seed` on deploy.
- Note: Vercel limits request bodies to about 4.5 MB. Either host the web app on a Node server, or lower `MAX_UPLOAD_BYTES` until direct-to-bucket uploads (presigned + finalize) are added.
- `APP_ENV=staging|production` refuses the fake provider, local storage, baseline moderation, console email and the Stripe mock.

## Provider configuration
Model capabilities live in `src/server/providers/capabilities.ts`, verified against the OpenAI SDK v7.55 type docs (Nov 2026): `gpt-image-1` is shut down; `gpt-image-2` takes up to 16 reference images, `n` 1–10, arbitrary `WxH` sizes (multiples of 16), and must not receive `input_fidelity`. To add a model, verify its capabilities in the current docs, add it to the map, and rerun the tests. The app caps references at 4 and falls back to a labelled reference sheet if a model accepts fewer.

## Security notes
Sessions are httpOnly SameSite=Lax cookies storing only SHA-256 token hashes, with an Origin check on every mutation. Passwords use scrypt. Uploads are sniffed and re-encoded by sharp, which strips EXIF and GPS data and enforces size limits. Images are served only through an ownership-checked route, and cross-tenant reads return 404. Rate limits live in Postgres. Prompts and uploads are moderated, and the provider's safety rejections refund credits. Every admin edit is audited.
