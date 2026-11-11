# AI Character Studio — Implementation Plan

Source of truth: `AI_CHARACTER_STUDIO_MASTER_BUILD.md`. This plan turns it into checklists.
Status legend: `[x]` done and tested (fake provider / Stripe mock) · `[~]` built, needs live credentials to verify · `[ ]` not started.

## Architecture summary

| Concern | Choice | Why |
|---|---|---|
| Web + API | Next.js 16 App Router, React 19, TypeScript (strict), Tailwind v4 | Blueprint default |
| Database | PostgreSQL 16 via `pg`, plain SQL migrations in `db/migrations` | Works on Supabase Postgres or any managed Postgres; explicit transactions and row locks for the credit ledger |
| Auth | App-managed email+password sessions (scrypt hashes, random session tokens stored as SHA-256, httpOnly cookies), email verification tokens | "Supabase Auth **or equivalent**". Fully testable offline; no vendor lock-in. Can be swapped for Supabase Auth later behind `src/server/auth` |
| Object storage | `StorageAdapter`: S3-compatible (Supabase Storage S3 endpoint, Cloudflare R2, AWS S3) + local-disk adapter for dev/test. Buckets are private; every download goes through an authorized route | Private-by-default assets |
| Async jobs | Postgres-backed durable queue (`generation_jobs` claimed with `FOR UPDATE SKIP LOCKED`, lease + heartbeat, retry with backoff) run by a separate worker process (`npm run worker`) | Job row is inserted **in the same transaction** as the credit reservation, so the outbox problem disappears. No Redis needed for Phase 1; BullMQ can be added later behind `src/server/queue` |
| Images | `ImageProvider` interface; `OpenAIImageProvider` (Images API, `gpt-image-2` default, model capability map) and `FakeImageProvider` (tests/dev only, refuses to run in production) | Verified against openai SDK v7.55 types (Nov 2026): `gpt-image-1` was shut down 2026‑10‑23; `gpt-image-2` accepts up to 16 input images, `n` 1–10, sizes `WxH` divisible by 16, `input_fidelity` must be omitted |
| Moderation | `ModerationProvider`: OpenAI `omni-moderation-latest` (text + image) with local keyword baseline; provider-side image safety errors mapped to `moderation_blocked` | Inputs and outputs |
| Image processing | `sharp`: decode-validate, size/pixel limits, EXIF/GPS strip, thumbnails, free-tier watermark | Safe processing |
| Billing | Stripe Checkout (subscription + one-time top-up), Billing Portal, signed webhooks, idempotent `payment_events` | Test mode only until owner approval |
| Email | `Mailer` adapter: console/outbox (dev) and Resend HTTP API (prod) | Email verification |
| Tests | Vitest against a real Postgres test database; Playwright smoke e2e with fake provider + signed synthetic Stripe events | |

### Request → job flow
1. UI posts `POST /api/generations/quote` → server validates auth, workspace, entitlement (plan × feature release state), asset ownership + consent, rate limit, moderation of prompt → immutable quote (10 min TTL).
2. `POST /api/generations {quoteId, idempotencyKey}` → one transaction: lock wallet, allocate credits from grants (included/trial first, purchased last, soonest expiry first), write `reserve` ledger rows, insert `generation_jobs` (status `queued`).
3. Worker claims job (`SKIP LOCKED`), loads references from private storage, calls provider with timeout, stores outputs privately (EXIF stripped, thumbnails, watermark if plan requires), records `usage_events`.
4. Settle: charge credits for delivered outputs only (`settle` ledger), release the rest (`release`). On terminal failure release everything. Retries are idempotent (outputs keyed by job + index).
5. UI polls `GET /api/generations/:id`.

## Assumptions (owner can override)
- Brand: "AI Character Studio"; dark charcoal + coral accent.
- Credit expiry: subscription credits expire at period end; purchased top-ups expire after 12 months; trial credits (15) expire after 30 days and are granted once per verified email (normalized, `+tag` stripped) — abuse control.
- Annual plans: Stripe bills yearly; credits are granted monthly by the worker's allocator.
- Free plan: 1024px max output, watermark, 1 concurrent job, no batch/photoshoot.
- Top-ups require an active paid plan (avoids free-tier credit farming). Configurable.
- Top-up fulfilment: `payment_intent.succeeded` with server-set metadata, amount/currency verified against the configured pack. Subscription credits: `invoice.paid` (one grant per invoice id). `checkout.session.completed` only links the customer — never grants credits.
- Phase 1 runs single-member personal workspaces; schema supports members/roles for Phase 4.
- The Scene Director is a deterministic structured-prompt builder (no extra LLM cost); an LLM enhancer can be added later.

---

## Phase 0 — Foundation and real-provider proof
- [x] Next.js + TS + Tailwind, ESLint, Vitest, typecheck scripts
- [x] SQL migrations + runner; seed of plans, 30 features, entitlements, credit rules
- [x] Auth: signup, login, logout, sessions, email verification, CSRF origin check
- [x] Private storage adapter (local + S3; S3 path not exercised without a bucket), upload validation (type, size, pixels), EXIF strip, thumbnails
- [x] Consent capture on upload (self / authorized third party) + consent receipts
- [x] Durable Postgres job queue + worker with lease, retries, backoff, stale-lease recovery
- [x] `ImageProvider` interface, OpenAI adapter, fake adapter (tests only), capability map
- [x] Moderation adapter (OpenAI + local baseline) on prompts and uploaded images
- [x] Credit quotes (immutable, expiring), atomic reserve / settle / release, ledger as source of truth
- [x] Per-job usage + provider cost accounting, cost hard-stop per job type
- [x] Ownership-checked download, asset deletion (soft delete + object removal)
- [~] **Gate:** one end-to-end *real* OpenAI image job — needs `OPENAI_API_KEY` and network access to `api.openai.com`

## Phase 1 — Paid MVP
1. Accounts
   - [x] Registration, login, email verification, onboarding (consent + first upload), account settings
   - [x] Account deletion request (immediate asset purge + account anonymization; Stripe subscription cancel)
2. Library
   - [x] Upload manager, private Character Library (profiles with references), asset library tabs
   - [x] Gallery with filter by tool, search, download, delete
3. Generator
   - [x] Shared studio shell: references by role, preset chips, editable prompt, aspect ratio, quality, output count, credit quote, progress, results, regenerate
4. Tools
   - [x] 01 `character_angles`
   - [x] 02 `environment_switch`
   - [x] 03 `reference_mixer` (4 labeled slots, capability fallback)
   - [x] 11 `ugc_ads` (synthetic-content + product accuracy warnings)
   - [x] One-Click Photoshoot (preset recipes, total quote, ZIP download)
   - [x] Identity Lock (reference strength presets → prompt + `input_fidelity` where supported)
   - [x] AI Scene Director (brief → structured prompt, editable)
   - Tools are `beta` (allowlist) until the live-provider gate passes, then admin flips them to `live`.
5. Billing (Stripe **test mode**)
   - [~] Checkout for subscriptions (monthly/annual) and top-ups; Billing Portal (verified against a local Stripe mock; needs test keys)
   - [x] Webhooks: signature verification, idempotency, subscription sync, invoice.paid grants, payment failure, top-up refunds/disputes (credit reversal clamped ≥ 0), deletion
   - [ ] Automatic credit reversal for refunded subscription invoices (manual admin adjustment for now)
   - [x] Monthly allocation for annual plans; credit expiry sweep
6. Gates, admin, limits
   - [x] Server-side entitlements by plan × release state × allowlist
   - [x] Rate limits (Postgres fixed window), per-plan concurrency, daily job cap
   - [x] Admin: features (state/tier/multiplier), credit rules, jobs/errors, cost & margin by tool/model, users, audit log
7. Dashboard + public pages
   - [x] Dashboard (credits, recent jobs, quick start, top-up CTA), Studio (all 30 tiles), Pricing (live vs coming soon), Landing, Legal templates, Contact
- [~] **Gate:** sign up → buy in Stripe test mode → upload → generate → debit → download → upgrade → delete, with cross-user isolation. Automated with fake provider + signed synthetic webhooks; needs Stripe test keys + `stripe listen` and an OpenAI key for the live run.

## Phase 2 — Creator expansion (not started)
- [ ] 04 expressions · 05 outfit_swap · 06 style_transform · 07 poses · 08 headshots
- [ ] 09 ai_twin identity profiles · 12 thumbnails (editable text overlay) · 13 social_content · 16 memes
- [ ] Dynamic masks, overlay text editor, updated public plan descriptions
- [ ] Gate: diverse authorized test set; identity persistence and export quality validated

## Phase 3 — Marketing and product (not started)
- [ ] 14 testimonial_layouts · 15 influencer_campaigns · 17 before_after · 18 ad_variations · 19 fashion_model
- [ ] 20 product_lifestyle · 21 digital_mockups · 22 product_demonstrator · 23 brand_mascots · 24 marketplace_images
- [ ] Brand kits, product libraries, campaign folders, platform size presets, multi-format export, client handoff
- [ ] Gate: synthetic-endorsement disclosures, label-fidelity checks, configurable marketplace specs

## Phase 4 — Agency expansion (not started)
- [ ] 10 character_interactions · 25 storyboards · 26 video_prep · 27 image_to_prompt · 28 restore_enhance · 29 scene_recreation · 30 batch_campaigns
- [ ] Teams, client workspaces, roles, priorities, export bundles, batch budgets + cancellation
- [ ] Optional MV3 Chrome extension
- [ ] Gate: stable batch processing, per-workspace billing visibility, access controls

## Before production (owner sign-off required)
- [ ] Provider account + key, approved models, cost ceilings
- [ ] Stripe live keys + Price IDs, Stripe Tax, branding, support contact
- [ ] Legal entity, privacy/terms/AUP reviewed by counsel, DPA with processors
- [ ] Hosting (web + worker), staging environment, Sentry DSN, backups
