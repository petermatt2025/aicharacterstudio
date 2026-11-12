# Progress

_Last updated: 2026-11-11_

## Working (tested)
| Area | What works | Evidence |
|---|---|---|
| Foundation | Next.js 16 + TS strict + Tailwind v4, SQL migrations, idempotent seed of 4 plans, 30 tools + photoshoot, 8 credit rules, 3 packs | `npm run build` ✓ |
| Accounts | Signup, email verification (single-use tokens), login/logout, sessions, profile, password change (revokes sessions), onboarding, account deletion (cancels Stripe sub, purges objects, anonymizes) | `accounts.test.ts`, e2e |
| Trial abuse control | 15 credits once per canonical email (+tags/gmail dots), survives deletion (hashed) | `accounts.test.ts` |
| Private storage | Sniffed/re-encoded uploads, EXIF/GPS stripped, size/pixel limits, consent receipts, moderation, ownership-checked downloads, deletion removes objects | `assets.test.ts`, e2e |
| Credit ledger | Bucket grants, priority/expiry ordering, atomic reserve, settle by delivered outputs, release, expiry sweep, refund/dispute revocation never negative, concurrency-safe | `credits.test.ts` |
| Jobs | Quote→job in one transaction, idempotency keys, single-use expiring quotes, SKIP LOCKED worker, leases + crash recovery, retries with backoff, per-output resume, partial charging, cancel, cost caps + kill switch | `generation.test.ts` |
| Provider | OpenAI adapter (generate/edit, capability map, error mapping, hashed safety id, token usage + optional cost), fake provider for tests | `providers.test.ts` (HTTP mocked) |
| Tools | 01 angles, 02 environment, 03 mixer (4 slots + reference-sheet fallback), 11 UGC ads (synthetic labels), One-Click Photoshoot, Identity Lock, Scene Director | `generation.test.ts`, e2e |
| Gates | Plan tiers, beta allowlist, coming-soon/planned never runnable, paused tools, plan limits, concurrency, daily caps | `generation.test.ts` |
| Billing | Checkout (subscription/top-up), portal, signed + idempotent webhooks, plan sync with out-of-order protection, invoice-based grants, no rollover, upgrade top-up, annual monthly allocation, top-up amount verification, refunds/disputes, live-mode blocked | `billing.test.ts`, e2e (Stripe mock) |
| UI | Landing, pricing (live vs coming soon, tax note), legal templates, contact, dashboard, studio (30 tiles), tool pages, library, gallery, billing, settings, admin (costs, flags, rules, users, jobs, audit) | e2e screenshots, 390px no-overflow check |

## Latest results
- `npm run lint`: 0 errors, 0 warnings
- `npm run typecheck`: pass
- `npm test`: 67/67 pass (6 files, real Postgres)
- `npm run build`: pass
- `npm run test:e2e`: 15/15 checks pass. Covers sign up, verify, consented upload, Free plan gated, Creator purchase (signed webhooks), 10-credit quote, 4 images, credits 215→205, download, upgrade to Pro (655), cross-tenant 404, anonymous 401, CSRF 403, mobile layout and account deletion.

## Bugs found and fixed by tests
- `grantCredits` swept an already-expired new grant before adding it to the balance, which violated the non-negative ledger check (annual allocation test).
- The upgrade allowance top-up depended on grant timestamps and over-granted when the billing anchor moved (found by e2e, regression test added).

## Blockers (need owner input)
1. ~~Real image generation~~ **Phase 0 gate passed (2026-11-11)** with `npm run provider:check`: a real `gpt-image-2` text-to-image (synthetic portrait), then upload with real OpenAI moderation → 3-credit quote → reservation → worker edit → private output → settlement 15→12 → usage recorded. Note: this sandbox's proxy cuts requests at about 30s, so `OPENAI_IMAGE_STREAM=true` is set locally; production hosts don't need it. Output cost is still unpriced until `OPENAI_IMAGE_*_USD_PER_MTOK` are filled in.
2. ~~Stripe test mode~~ **Verified against the real Stripe test API (2026-11-11)** with `npm run stripe:check`: 9 test prices created by `npm run stripe:setup`, real Checkout Sessions, and real events for subscribe (215), proration upgrade (665), top-up (765), partial refund (715), replay of 27 events (no-op) and cancel → Free. Still to do once deployed: a dashboard webhook endpoint with its own signing secret, and one checkout completed in a browser on checkout.stripe.com.
3. Pricing inputs for cost reports (`OPENAI_IMAGE_*_USD_PER_MTOK`) must be copied from the current pricing page.
4. Legal templates need counsel review. Brand, domain, support email and legal entity are placeholders.

## Known limitations / next tasks
- Uploads go through the app server (15 MB). For Vercel, add presigned direct-to-bucket uploads with a finalize step.
- Scene Director is deterministic (rule-based), with no LLM enhancer yet.
- Subscription refunds are handled by Stripe plus a manual admin credit adjustment. Only top-up refunds revoke credits automatically.
- No Sentry or alerting yet: logs are structured JSON to stdout, and cost caps act as hard stops.
- Phase-1 tools stay `beta` until the real-provider run. Then flip them to `live` in `/admin`.
- Phases 2–4 have not started; their tools are cataloged only.

## 2026-11-12 — All 30 tools implemented (beta), engines, editor
- Engines: OpenAI (gpt-image-2) and Gemini (gemini-3.1-flash-image), chosen per job; worker generates a job's images in parallel.
- Tools: Phase 2 (04–09, 12, 13, 16), Phase 3 (14, 15, 17–24) and Phase 4 (10, 25–30) are implemented and released as **beta**
  (admins + allowlisted users). Each still needs a real-provider spot check before an admin flips it to `live`.
- Image Editor (from Gallery: Edit, Enhance, Upscale, Expand/outpaint, Remove BG, Variation) and Image-to-Prompt (Gemini vision).
- Prompt Builder (ideas + style/mood/lighting/framing/outfit/background chips + Surprise me) on every tool.
- Admin accounts use top-plan limits. Tests: 100 unit/integration + browser e2e passing.
- Not verified live yet: Image-to-Prompt and outpaint against real providers (the sandbox proxy can't send Gemini's header).
- Style boards (moodboards): /styles page, up to 12 images per board, Gemini "Describe this style", applied in any tool as
  one style-sheet reference + style notes; Image Editor "Apply style board" and Gallery "Restyle". Workspace-private.
- 20 art styles (anime, pop art, comic, pixel art, cyberpunk…) in the prompt builder; art styles override photoreal framing.
- Text Studio (/text/:assetId): exact text layers on any image, 11 self-hosted fonts, colour/outline/shadow/frame/
  position/rotation/spacing, 8 one-click looks; saved as a NEW image after text + image moderation (free, no AI).
- Landing page redesigned ("sunset vivid"); showcase images are real gpt-image-2 outputs of fictional people.
- OpenAI account ran out of credit on 2026-11-12: the OpenAI engine fails until topped up (now detected as non-retryable).
