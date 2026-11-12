# Deploying a private staging copy on Railway

This runs the app as **staging**: real OpenAI images, Stripe **test mode only** (live keys are refused),
invite-only sign-up. It is not a production launch.

The repo ships a `Dockerfile`; Railway builds it automatically. One image, two services:
`APP_ROLE=web` (runs migrations + seed, then the website) and `APP_ROLE=worker` (generates images).

## 1. Create the project
1. Railway → **New Project → Deploy from GitHub repo** → `aicharacterstudio`. This creates the first service; rename it `web`.
2. In the project canvas: **+ Create → Database → PostgreSQL**.
3. **+ Create → Bucket** (S3-compatible storage for private images). Open it and keep its **Credentials** tab handy.
4. **+ Create → GitHub Repo** → `aicharacterstudio` again; rename this service `worker`.
5. `web` → Settings → Networking → **Generate Domain**. Note the URL (e.g. `https://web-production-xxxx.up.railway.app`).

## 2. Variables (shared by both services)
Project → **Settings → Shared Variables**, then on each service → Variables → add all shared variables.

| Variable | Value |
|---|---|
| `APP_ENV` | `staging` |
| `APP_URL` | the `web` domain from step 1.5, with `https://` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | from the Bucket's Credentials tab |
| `IMAGE_PROVIDER` | `openai` |
| `OPENAI_API_KEY` | your OpenAI key (secret) |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` |
| `MODERATION_PROVIDER` | `openai` |
| `STRIPE_SECRET_KEY` | your `sk_test_…` key (secret) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from step 3 (secret) |
| `EMAIL_TRANSPORT` | `resend` |
| `RESEND_API_KEY` | from resend.com (secret) |
| `EMAIL_FROM` | `AI Character Studio <onboarding@resend.dev>` (until you verify a domain, Resend only delivers to your own Resend account email) |
| `ADMIN_EMAILS` | your email |
| `SIGNUP_ALLOWED_EMAILS` | your email (add testers comma-separated) |
| `STRIPE_PRICE_*` | the nine test price IDs (see `.env.example` names; values from `npm run stripe:setup`) |

Service-only variable: `worker` → `APP_ROLE=worker`. (`web` needs nothing: the default role is `web`.)

## 3. Stripe test webhook
Stripe Dashboard (**Test mode**) → Developers → Webhooks → **Add endpoint**:
- URL: `<APP_URL>/api/webhooks/stripe`
- Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`,
  `invoice.paid`, `invoice.payment_failed`, `payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created`
- Copy the **Signing secret** into `STRIPE_WEBHOOK_SECRET` on both services.

## 4. Check
- `<APP_URL>/api/health` returns `{"ok":true}`.
- `worker` logs show `worker.start … provider: openai`.
- Sign up with your email → verification email → you are admin with beta tools.

If the bucket rejects uploads with an addressing error, set `S3_FORCE_PATH_STYLE=true` on both services.
