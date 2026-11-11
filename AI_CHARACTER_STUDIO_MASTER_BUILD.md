# AI Character Studio - Master Build Specification

Version: 1.0 | Date: 2026-11-11 | Intended builder: Claude Code

## 0. EXECUTION INSTRUCTIONS FOR CLAUDE CODE

You are the lead product engineer, architect, UI designer, security engineer, and QA engineer building **AI Character Studio**, a production-oriented cloud SaaS for image creation, editing, multi-reference composition, UGC advertising visuals, and branded content.

**Read this entire file first.** Treat this as the product requirements document and source of truth. Implement incrementally, with working vertical slices. Do NOT attempt 30 integrations in a single pass. The entire 30-tool catalog must exist in configuration and the product roadmap, but only mark a feature `live` after its end-to-end implementation is tested. Unreleased features may appear as clearly marked `Coming Soon`, never as functional features, fake demos, or purchase promises.

Before coding: inspect repo, document assumptions, establish a phased task checklist in `docs/IMPLEMENTATION_PLAN.md`, and summarize architecture. If repository is empty, scaffold it. Do not ask repetitive questions; make sensible defaults. Ask for secrets/payment configuration only at the relevant integration stage. Never fabricate API responses or claim external integrations work without tests.

Prioritize completing PHASE 1 (usable product, including real generation, accounts, credits, payment integration in test mode) before building PHASES 2-4. Code must compile, type-check, and have automated tests. Keep `.env.example` complete without exposing credentials. Do not deploy or activate real-money billing without explicit owner approval.

### Definition of done for every tool

- A visible page with instructions, example use cases, inputs, validation, controls, and preview.
- A real server-side generation/editing job via a provider adapter, with retries/timeouts/error states.
- Estimated credit usage shown BEFORE submitting; credits reserved atomically and settled according to actual cost.
- Progress/status and downloadable results, saved history, ownership enforcement, and deletion support.
- Safety checks, moderation handling, authorized-reference/consent UX, and at least one automated end-to-end happy-path and failure-path test.
- Feature gates enforce entitlements on the server, not merely by hiding buttons.

## 1. PRODUCT VISION

**Working product name:** AI Character Studio (configurable brand name and domain).

**Positioning:** Upload your photo once. Create AI photoshoots, consistent character scenes, UGC ad concepts, product campaigns, marketing images, and social visuals from reusable references.

**Primary buyers:** creators, coaches, affiliate marketers, social media managers, e-commerce sellers, digital product creators, UGC marketers, small agencies. Secondary audience: hobbyists and professional photographers.

**Key differentiators:**

1. Reusable **Character Library** and **Identity Lock** settings.
2. **Visual Layer Mixer** with person/product/outfit/background slots (up to 4 initially, designed for more).
3. **One-Click Photoshoot** with multiple varied scenes from a saved profile.
4. Natural-language **AI Scene Director** to turn short directions into structured prompts.
5. **Campaign and batch generation** tied to commercial content outcomes rather than abstract art.
6. Clean feature catalog, saved assets, history, brand kits, and credit visibility.

**Honest product limits:** Identity consistency, body geometry, hands, logos, text, product label fidelity, and exact poses cannot be guaranteed. Display a realistic caveat, and enable regenerate/revise. Images representing testimonials, endorsements, or real events must never be presented as authentic evidence unless genuine. Secure consent and rights to all uploaded people and assets.

## 2. RELEASE MODEL AND ENTITLEMENTS

Use release-state flags and tier entitlements for every feature:

- `planned`: catalog record, not visible except optional roadmap.
- `coming_soon`: teaser with accurate upcoming-status badge, no fake submit.
- `beta`: works for allowlisted users, labeled beta.
- `live`: available for entitled subscriptions.
- `paused`: temporary disable with explanation.

All 30 tools have a stable `feature_key`, one primary studio, a release phase, an initial paid tier, and a variable credit multiplier. Admin may edit phase/status/tier/multiplier without changing code. Credit quotes are server-side.

### Tiers (proposed, adjustable by admin)

| Tier | Monthly USD | Annual USD | Included monthly credits | Who it's for |
|---|---:|---:|---:|---|
| Free | 0 | 0 | 15 one-time trial credits | Discovery, limited generation |
| Creator | 19 | 190 | 200 | Individuals and creators |
| Pro | 49 | 490 | 650 | Marketers, creators, small sellers |
| Agency | 99 | 990 | 1500 | Teams, campaign specialists |

Rules:
- Trial credits are one-time per eligible account, not 15 recurring every month. Add abuse controls.
- Monthly credits expire at the end of their billing period unless owner chooses otherwise; do not silently roll over. Annual plans get a monthly credit allocation, not all credits at once.
- Purchased add-on credits persist for 12 months unless a different legally compliant policy is selected and disclosed before purchase. Spend included credits before purchased credits. Gracefully handle expiry.
- Never grant paid credits on `checkout.session.completed` alone; fulfill on the correct authoritative Stripe subscription/payment event after verifying signatures, state, and idempotency.
- Subscription downgrade takes effect at the end of the current period by default; plan upgrade follows confirmed payment and proration rules shown to the user.
- Credit limits are hard: no negative balances or unpaid overages. Reject insufficient balance before job enqueue.
- Commercial usage is allowed only to the extent permitted by provider terms and customer rights. Do not represent model output ownership as an unconditional legal guarantee.
- Free plan: limited generation resolution, watermark on downloads/previews, low concurrency, no batch jobs or commercial client workspaces. Watermarking is performed after generation if allowed by provider terms.
- Creator: 1 workspace, personal image studios, standard queue, basic export.
- Pro: full creator + UGC/advertising/mixer/product tool access as these become live, batch jobs, brand kits, higher concurrency.
- Agency: Pro + team seats (initially 3), client workspaces, priority queue, advanced feature access, export bundles, configurable branded presets.
- Plan visibility and tool gates must remain coherent across releases. Do not advertise as available what has not shipped.

### Suggested top-ups

| Pack | USD | Credits |
|---|---:|---:|
| Small | 12 | 100 |
| Growth | 49 | 500 |
| Studio | 99 | 1200 |

All prices are initial **business hypotheses**, not verified market benchmarks. Allow Stripe Price IDs in environment/database. VAT, sales tax, currency conversion, refunds, and invoices are handled through the chosen billing/tax workflow. Prices in the UI should clearly state tax treatment. Do not hardcode Portuguese VAT rates.

### Initial generation credit schedule (CONFIGURABLE; NOT A COST GUARANTEE)

| Operation | Initial credits |
|---|---:|
| Standard image generation, small/medium | 2 |
| High quality image | 5 |
| Reference edit with one input | 3 |
| Multi-reference composition (2-4 inputs) | 4 |
| Advanced identity-preserving generation | 5 |
| Character angle sheet (4 outputs) | 10 |
| One-click photoshoot (12 standard outputs) | 24 |
| Upscale/enhance | 2 |
| Bulk content campaign | quote each output + overhead explicitly |

These are starter retail weights, **not provider dollar costs**. For each job capture input/output token usage, model, resolution, quality, reference count, moderation and retry costs, storage, and net payment fees. Implement cost report and automatically disallow job types whose cost cap is breached. An admin can change credit rules based on observed cost. A single image may require multiple calls; no claim of 1 image = 1 API call.

### Unit economics framework

Use: `estimated_provider_cost = sum(model API charges) + image processing + storage + bandwidth + retries`; `contribution = subscription revenue - payment fees - generation costs - platform costs - support - taxes/adjustments as applicable`. In admin, show 7/30-day cost per user, plan, tool, provider/model and actual gross margin. Use configurable soft/hard per-user monthly provider-dollar budgets and anomaly alerts.

**Planning illustration only:** if a customer uses 200 credits on 100 standard outputs, and a hypothetical all-in API cost is $0.07 per output, generation costs about $7 before infrastructure/payment/support. The real cost must be determined by production metering. Never assume this $0.07 is a current official API tariff. For external pricing, consult provider pages at implementation time:
- OpenAI: https://developers.openai.com/api/docs/pricing
- Stripe Portugal: https://stripe.com/pt-pt/pricing
- Anthropic Claude Code: https://docs.anthropic.com/en/docs/claude-code/overview

## 3. COMPLETE 30-TOOL FEATURE CATALOG

**Tier** means minimum plan required **once the tool is live**. **Phase** means targeted implementation order, not a date commitment. The catalog is an explicit product requirement; nothing below should be omitted.

| ID | Tool / Stable key | Studio | Phase | Minimum tier | Inputs and primary outputs |
|---|---|---|---|---|---|
| 01 | Character Angle Generator `character_angles` | Character | 1 | Creator | Portrait -> front/profile/3-quarter/high/low view sheet and individual images |
| 02 | Environment & Lifestyle `environment_switch` | Scene | 1 | Creator | Portrait + selected scene -> composited environment variants |
| 03 | Multi-Reference Image Mixer `reference_mixer` | Mixer | 1 | Pro | Character + product + clothing + background -> combined UGC-style scene |
| 04 | Facial Expression Studio `expressions` | Character | 2 | Creator | Portrait + expression categories -> expression sheet |
| 05 | Outfit & Style Switcher `outfit_swap` | Character | 2 | Creator | Character + reference outfit or text -> new outfit images |
| 06 | Character Style Transformer `style_transform` | Character | 2 | Creator | Photo + artistic style -> transformed illustration/photo |
| 07 | Pose Generator `poses` | Character | 2 | Creator | Character + chosen pose -> pose variations |
| 08 | Professional Headshot Factory `headshots` | Character | 2 | Creator | Character + professional style -> headshots |
| 09 | AI Twin / Identity Profile `ai_twin` | Character | 2 | Pro | Multiple consented images -> reusable identity profile and generation presets |
| 10 | Character Interaction Studio `character_interactions` | Scene | 4 | Agency | 2-3 consented character profiles -> coherent group scenes |
| 11 | UGC Ad Creative Factory `ugc_ads` | UGC & Ads | 1 | Pro | Product/character + ad angle -> creative photo variations |
| 12 | Thumbnail Generator `thumbnails` | Content | 2 | Pro | Face + title + platform -> thumbnail composition with editable text overlay |
| 13 | Social Media Content Factory `social_content` | Content | 2 | Pro | Character + platform + theme -> post/story/carousel cover assets |
| 14 | Testimonial Scene Creator `testimonial_layouts` | UGC & Ads | 3 | Pro | Verified customer quote + licensed photo -> labeled promotional layout |
| 15 | Influencer Brand Campaigns `influencer_campaigns` | UGC & Ads | 3 | Agency | Consented virtual model + brand assets -> campaign series |
| 16 | AI Meme Creator `memes` | Content | 2 | Creator | Character + meme concept -> humor layouts |
| 17 | Before/After Creator `before_after` | Content | 3 | Pro | Consented photos + design brief -> clear concept transformation comparison; no deceptive results |
| 18 | Ad Variation Generator `ad_variations` | UGC & Ads | 3 | Pro | Existing creative + product/brand -> alternative ad angles/layouts |
| 19 | AI Fashion Model Studio `fashion_model` | Product | 3 | Agency | Clothing + licensed character -> fashion scenes; note fit/accuracy limitations |
| 20 | Product Lifestyle Photography `product_lifestyle` | Product | 3 | Pro | Product photo + theme -> lifestyle product images |
| 21 | Digital Product Mockup Builder `digital_mockups` | Product | 3 | Pro | Covers/screenshots + mockup format -> device/box/bundle displays |
| 22 | Virtual Product Demonstrator `product_demonstrator` | Product | 3 | Pro | Person + object -> product-in-hand scenes, clearly illustrative |
| 23 | Brand Mascot Factory `brand_mascots` | Character | 3 | Pro | Prompt/brand kit -> reusable fictional mascot reference library |
| 24 | Marketplace Image Optimizer `marketplace_images` | Product | 3 | Pro | Product photo + platform specification -> optimized image variants |
| 25 | Storyboard Generator `storyboards` | Content | 4 | Agency | Character + multi-scene brief -> 6-12 scene storyboard |
| 26 | AI Character Video Preparation `video_prep` | Content | 4 | Agency | Character + script -> consistent still frames, prompts, exports; not video generation |
| 27 | Image-to-Prompt Analyzer `image_to_prompt` | Mixer | 4 | Pro | Source image -> structured visual prompt and editable descriptors |
| 28 | Photo Restoration & Enhancement `restore_enhance` | Scene | 4 | Creator | Damaged portrait -> repaired/enhanced image, transparent limitations |
| 29 | Scene Recreation `scene_recreation` | Scene | 4 | Agency | Source composition + consented person/object -> original recreation |
| 30 | Batch Campaign Generator `batch_campaigns` | UGC & Ads | 4 | Agency | Campaign brief + character + products -> queued multi-format images |

### Five cross-cutting capabilities (not extra tool IDs)

- **Identity Lock:** identity profile metadata, reference-strength presets, consistency guidance, optional face comparison quality heuristic, truthful error messaging. Never claim guaranteed matching.
- **Visual Layer Mixer:** individual slot control for person, garment, object, background; editable masks/placement wherever supported.
- **AI Scene Director:** brief-to-structured-prompt service (subject, scene, lens, lighting, expression, pose, constraints, negative instructions, aspect ratio); user can edit it.
- **One-Click Photoshoot:** preset recipes generating multiple variants from one identity with an upfront total credit quote, progress UI, and zip download.
- **Reusable Asset Library:** private image profiles, products, outfits, background libraries, brand kit, consent metadata, image version history.

## 4. BUILD PHASES AND ACCEPTANCE GATES

### Phase 0 - Foundation and real-provider proof-of-concept

1. Set up Next.js + TypeScript, Tailwind CSS, accessible component library, lint/test/typecheck.
2. Set up Supabase Postgres/Auth/Storage or equivalent managed Postgres + Auth + S3-compatible private object storage. Use least-privilege policies.
3. Set up a durable asynchronous job queue; use BullMQ/Redis or hosted job orchestrator. Avoid expensive image processing within a synchronous web request.
4. Build `ImageProvider` interface, one real provider implementation, a deterministic fake adapter **for tests only**, model/feature capability mapping and per-job accounting.
5. Prove: upload portrait -> generate one image with real provider -> private output -> download -> cost ledger. Confirm consent, moderation, ownership and deletion.
6. Build transparent credit quote flow with atomic reserve/finalize/refund.

**Gate:** one end-to-end real image job and complete observability before expanding UI.

### Phase 1 - Paid MVP

Deliver these in this order:

1. Registration/login, email verification, onboarding, account settings, deletion request.
2. Upload manager, private character library, asset library, gallery with search/filter/download/delete.
3. Generator UI using shared wizard components (source photos, preset chips, editable prompt, aspect ratio, quality, seed if supported, variations).
4. `character_angles` (01), `environment_switch` (02).
5. `reference_mixer` (03) with up to four clearly labeled inputs and a capability fallback if specific image provider cannot handle all at once.
6. `ugc_ads` (11), specifying illustrative synthetic marketing content and product accuracy warnings.
7. One-click photoshoot (cross-cutting), initial scene presets.
8. Identity Lock controls and AI Scene Director, both implemented via provider capabilities + prompts rather than claims of bespoke training.
9. Stripe test-mode checkout, subscriptions, webhook reconciliation, billing portal, add-on credits, invoices/receipts through provider.
10. Feature gates for Free/Creator/Pro/Agency, settings-admin, cost and job dashboard, rate limits, onboarding and pricing page.
11. User dashboard: creation count, remaining credits, previous images, quick-start buttons, credits quote and top-up CTA.

**Gate:** a new user can sign up, purchase in Stripe test mode, upload photo, generate image, see debited credits, download it, upgrade plan, and request deletion. Check image access cross-user isolation.

### Phase 2 - Creator expansion

Add 04 expressions, 05 outfit swap, 06 style transform, 07 poses, 08 headshots, 09 AI Twin identity profiles, 12 thumbnails, 13 social content, 16 memes. Make dynamic masks and editable overlay text where feasible. Do not silently enable new tools for plans without updating public plan descriptions.

**Gate:** templates, identity persistence, export quality and repeatable results validated with a diverse authorized test set.

### Phase 3 - Marketing and product upgrade

Add 14 testimonial layouts, 15 influencer campaigns, 17 before/after, 18 ad variations, 19 fashion, 20 product lifestyle, 21 digital mockups, 22 product demonstrator, 23 mascots, 24 marketplace optimizer. Build brand kits, product libraries, campaign folders, platform size presets, multi-format export, client handoff.

**Gate:** consumer-facing disclosures for synthetic endorsements, product label fidelity checks, accessible brand kit and campaign reuse. Marketplace requirements configurable and documented; never promise platform approval.

### Phase 4 - Agency expansion

Add 10 character interactions, 25 storyboards, 26 video preparation, 27 prompt analysis, 28 restoration, 29 scene recreation, 30 batch campaigns. Add teams/client workspaces, roles and permissions, client segregation, agency usage overview, job priorities, export bundles, batch budgets and cancellation. Optional Chrome extension after web app stabilizes.

**Gate:** stable asynchronous batch processing, per-workspace billing visibility and access controls, consent policy and provider limitations tested.

### Chrome extension (later separate deliverable)

Build Manifest V3 extension that lets users right-click an image they have rights to use, select "Send to AI Character Studio", authenticate safely, and open a prefilled SaaS workflow. Never scrape private pages, browser cookies, inaccessible resources, or bypass site restrictions. Request narrow permissions, perform all model calls server-side, and maintain one codebase for billing/jobs/assets.

## 5. RECOMMENDED ARCHITECTURE

### Stack

- Frontend: Next.js App Router, TypeScript, Tailwind CSS, accessible shadcn/ui-style components.
- Auth / DB / storage: Supabase Auth + PostgreSQL + private Supabase Storage; migrations in version control. If existing stack differs, adapt without unnecessary rewrites.
- Async jobs: durable Redis/BullMQ workers or a managed queue; keep image workloads off frontend/serverless request timeout path.
- Billing: Stripe Checkout + Billing Portal + validated signed webhooks; Stripe Tax where applicable after owner configuration.
- Images: OpenAI and/or Google image API through a provider adapter; do not assume a model supports every operation, or hardcode model names without API capability verification. Model settings managed server-side.
- Monitoring: structured logs, Sentry or equivalent, usage dashboards, budget alarms.
- Deployment: Vercel or equivalent for frontend/API, dedicated worker hosting for queue; separate staging and production environments.
- CI: GitHub Actions or equivalent lint, typecheck, unit, integration and e2e tests.

### Adapter contract

Define `ImageProvider` with:

```ts
type GenerationRequest = {
  userId: string;
  workspaceId: string;
  featureKey: string;
  prompt: string;
  references: Array<{ assetId: string; role: 'character'|'product'|'outfit'|'background'|'style'|'other' }>;
  requestedOutputs: number;
  aspectRatio: '1:1'|'4:5'|'9:16'|'16:9'|'3:2';
  quality: 'standard'|'high';
  maskAssetId?: string;
  options?: Record<string, unknown>;
};

type GenerationResult = {
  outputs: Array<{ bytesOrSecureObjectKey: string; mimeType: string }>;
  provider: string;
  model: string;
  usage: Record<string, number | string>;
  providerCostUsdEstimate: number | null;
  warnings: string[];
};

interface ImageProvider {
  capabilities(): Promise<Record<string, boolean | number>>;
  generate(input: GenerationRequest): Promise<GenerationResult>;
}
```

Do not put raw API keys, signed storage URLs, or private asset data in logs. Signed output URLs must be short-lived and authorization checked each time. Use image decoding/format/size limits and safe processing.

### Image workflow

1. User chooses tool -> UI assembles structured references/preset data.
2. Server checks auth, workspace membership, feature entitlement, provider capability, rate limits, upload ownership/consent, moderation, and input size/type.
3. Server computes immutable quote (`credits`, estimated outputs, tier, model/quality); user explicitly confirms.
4. Within DB transaction: lock credit balances, reserve credits in ledger, create job with idempotency key, write queued event.
5. Enqueue job transactionally via outbox pattern or recoverable queue publishing logic.
6. Worker fetches privately authorized reference images, builds prompt, calls provider, records provider billing/usage and moderation results.
7. Store generated assets privately, validate MIME/dimensions, generate thumbnails, redact EXIF/geolocation, watermark trial if configured.
8. Settle credit ledger on success. On failure release/refund unused reserved credits; handle partial batch completion and retries idempotently.
9. Notify UI via polling/SSE; show downloadable results and warnings.
10. Track auditable usage/cost/entitlement metrics with restricted admin access.

### Security, compliance, trust

- User must certify ownership or permission to upload and transform photos; explicit consent is required for identifiable third-party people. For high-risk impersonation and deceptive endorsements, prevent or restrict usage.
- No non-consensual intimate imagery, sexual exploitation, impersonation intended to deceive, or fake product endorsements as real customer evidence. Enforce moderation at inputs/outputs consistent with providers and applicable law.
- Allow users to delete reference images, generated assets, and account data subject to lawful retention obligations; implement cascade cleanup for derived image files and backups policy.
- Process personal data according to applicable GDPR obligations, privacy disclosures, retention rules, processor agreements, cross-border transfers and security requirements. Face images are sensitive from a privacy perspective; avoid building biometric identification or face recognition without a separate lawful/privacy review.
- Strong row-level authorization for all user assets, jobs, workspaces, credit accounts; verify in server tests. Rate limits, bot defense, file validation, admin audit logs.
- Protect against prompt injection in images/metadata or user text; never execute generated instructions.
- Never train separate models on customer photos without explicit opt-in and a reviewed policy.
- Synthetic advertising imagery must be distinguishable where required by law/platform rules; support disclosure labels.
- Do not guarantee exact reproduction of logos, labels, body shape, product claims, or platform compliance.

## 6. DATABASE DESIGN (INITIAL)

Use migrations with UUID primary keys, timestamps, constraints and indexes. Suggested entities:

- `users` / `profiles`: auth identity, contact, status, settings.
- `workspaces`: owner, name, plan context; `workspace_members`: role, invitation status.
- `subscriptions`: workspace, stripe_customer_id, stripe_subscription_id, price_id, status, current_period_start/end, cancel_at_period_end.
- `plan_catalog`: keys, display name, monthly/annual price reference, seat cap, limits; `features`: key, name, studio, phase, release state, min tier, description, display order.
- `plan_entitlements`: plan, feature key, is_enabled, concurrency, resolution.
- `credit_wallets`: workspace/account and balances derived from ledger; `credit_ledger`: earned/reserved/settled/released/expired/refunded/purchased, quantity, source, period, idempotency id, timestamps. Make ledger the source of truth.
- `credit_grants`: source subscription/top-up/trial, remaining, expiry, allocation order. `credit_quotes`: immutable terms + expiration.
- `assets`: user/workspace, type (character/product/outfit/background/output), private storage key, original filename, mime, bytes, dimensions, provenance, consent status, deletion timestamp.
- `character_profiles`: name, owner, primary image, list of authorized references, identity-strength default, notes.
- `brand_kits`: logos, fonts as data, color values, overlays, safe formatting.
- `presets`: feature, instructions, example settings, status, platform sizes.
- `generation_jobs`: workspace, user, feature, status, request snapshot, quote ID, retries, actual usage, error code, timestamps; `generation_job_inputs` and `generation_job_outputs` joins to assets.
- `usage_events`: provider, model, token/usage figures, provider cost estimate, duration, retry count.
- `payment_events`: Stripe event ID unique, processing result, timestamps, safely redacted payload hashes.
- `admin_audit_events`: actor, action, target, timestamp, redacted context.

Implement `unique` constraints for Stripe event IDs, job idempotency keys and purchases. Use SQL transactions/locks for credit wallets; do not trust client-provided balances. Ensure each storage object can be accessed only by owning account/workspace.

## 7. ROUTES / UI REQUIREMENTS

Public:

- `/` landing page: hero, before/after conceptual visual demos with clear illustrative labels, key studios, examples, how-it-works, benefits, pricing, FAQs, sign-up CTA.
- `/pricing` plan comparison including live vs coming-soon features, available credit operations, annual/monthly toggle, taxes caveat.
- `/legal/privacy`, `/legal/terms`, `/legal/acceptable-use`, `/contact` owner-editable templates requiring legal review before launch.

Authenticated:

- `/dashboard`: quick generation, credits remaining, job history, upgrade CTA.
- `/studio`: six studio categories (Character, Scene, Image Mixer, UGC & Ads, Product, Content), tiles for **all 30 tools** with live/beta/coming-soon status, tier badges only as secondary metadata.
- `/studio/[featureKey]`: reusable generator shell with uploaded references, preset chooser, advanced controls, credit quote, generate, progress, results, regenerate.
- `/library`: tabs Characters, Products, Outfits, Backgrounds, Generated Images, Brand Kits.
- `/gallery`: grid/list filters by feature, date, campaign, aspect ratio, status; bulk select, favorites, downloads, delete.
- `/campaigns`: grouped assets, shot lists, batches (future feature-gated).
- `/billing`: plan, credit usage ledger, top-ups, billing portal, invoices, cancel/upgrade.
- `/settings`: profile, password/auth, privacy, account deletion, consent receipts.
- `/admin`: private RBAC-guarded metrics, users/workspaces, plans, prices/credits, feature flags, queue/errors, provider cost and margin, abuse review, audit logs.

Design direction: premium dark charcoal interface, restrained electric orange/coral accent, spacious cards, clean typography, obvious CTA, compelling photographic example placeholders clearly tagged as examples. Fully responsive and keyboard navigable. Support light mode optionally. No complex dashboard before it is useful.

### Generation wizard controls

- Pick saved Character or upload authorized images.
- Add optional references with role labels; show max allowed and provider limitations.
- Pick scene/template, aspect ratio, output count, quality; use safe defaults.
- Prompt textarea with "Enhance with Scene Director", then allow manual editing.
- For mixer show four named slots: Character, Product/Object, Outfit, Background, with reorder/replace/remove.
- Preview credit cost, remaining balance, and expected output count before queueing.
- Show queue state, cancellability rules, moderation results, retry/refund explanation, and a gallery of outputs.
- Download JPG/PNG/WebP as technically supported, native dimensions or paid upscale, ZIP when batch completes.

## 8. API CONTRACT (EXAMPLE, ADAPT TO FRAMEWORK)

- `GET /api/me`, `GET /api/features`, `GET /api/plans`, `GET /api/credits/balance`.
- `POST /api/uploads/sign` -> presigned private upload target (auth and quota checked).
- `POST /api/assets` -> finalize/upload metadata; `GET /api/assets`, `DELETE /api/assets/:id`.
- `POST /api/characters`, `GET /api/characters`, `PATCH /api/characters/:id`, `DELETE /api/characters/:id`.
- `POST /api/generations/quote` -> amount, model class, outputs, expiry and quote ID.
- `POST /api/generations` -> job ID (requires quote ID + idempotency key).
- `GET /api/generations/:id`, `POST /api/generations/:id/cancel`, `GET /api/generations`.
- `POST /api/billing/checkout`, `POST /api/billing/top-up`, `POST /api/billing/portal`.
- `POST /api/webhooks/stripe` -> signature verification and idempotent processing.
- `GET /api/admin/usage`, `PATCH /api/admin/features/:featureKey`, `PATCH /api/admin/credit-rules/:ruleId` (RBAC).

All mutation endpoints require auth (except verified webhook), CSRF/session protections appropriate to auth method, validation with Zod, reasonable per-user quotas, and structured error codes.

## 9. BILLING LOGIC AND EDGE CASES

- Prices in Stripe are source of truth for paid amounts, but internal tier mapping must be validated and auditable.
- Subscription creation, cancellation, payment failure, refund, disputes, duplicate webhooks, retries, mid-cycle upgrade/downgrade and account deletion must be tested.
- Process webhooks idempotently; grant credits once per paid billing period or confirmed top-up payment. No free credit double-claiming through account recreation.
- On subscription failure follow configured grace policy; no new premium jobs after grace. Retain user assets within defined retention policy unless deleted.
- Show per-generation prices as credits and approximate output counts without guaranteeing a number if image quality/provider changes.
- If a job fails due to our system/provider error, release its reserved credits. Partial results are charged only for delivered successful outputs according to quoted policy; no unannounced extra charges.
- Refund processing and associated credit reversals follow transparent written rules; never create negative wallet spendable balances.
- Rate limits, abuse detection, concurrency caps and cost controls must survive subscription tampering and client requests.

## 10. QUALITY / TEST PLAN

Create tests for:

1. Login, account verification and authorization for user/workspace roles.
2. Private upload storage, file-type/size validation, image metadata stripping, secure download.
3. Feature flags and plan gates enforced by server and reflected in UI.
4. Quote/reservation/settlement on success, failure, cancellation, retries and partial batch outcomes.
5. Concurrent requests cannot overspend wallet; idempotent duplicate job submission.
6. Stripe checkout (test mode), verified webhooks, duplicates, payment failures, renewals, refunds and upgrades.
7. Prompt construction: uploaded roles map correctly to provider inputs; unsupported features handled gracefully.
8. Gallery image ownership; no direct access across tenants; workspace segregation.
9. Moderation and consent checkpoints, including rejected/flagged inputs.
10. Mobile responsive UX, accessibility focus/order, loading and error states.
11. Admin permission boundary and audit logs.
12. Provider outage, throttling, timeouts, cost-cap reached and queue recovery.

Run lint, TypeScript typecheck, unit/integration tests and end-to-end checks at the end of every milestone. Document failing tests rather than claiming success.

## 11. ANALYTICS AND GROWTH

Instrument user journey: landing -> signup -> first upload -> quote -> generation success -> gallery -> first paid conversion -> recurring usage -> upgrade/top-up. Show metrics: trial-to-activation, trial-to-paid, ARPU, retention, plan churn, credits purchased/used, actual API cost/user, failed jobs, cost per delivered output, storage usage, top templates, agency expansion. Respect analytics consent/privacy requirements.

Growth features (after stable MVP):
- Watermarked free previews with unobtrusive branding if permitted.
- Referral codes with fraud prevention, not an uncontrolled free-credit loophole.
- Share links disabled by default, explicit opt-in and revocable.
- Preset/template gallery, email onboarding, tutorial videos, waitlists for unfinished features.
- Optional affiliate program with payouts only after fraud/chargeback checks; keep separate from model credits.

## 12. ADMIN-EDITABLE COMMERCIAL SETTINGS

Admin should be able to manage without code changes:

- Plan names, descriptions and corresponding Stripe Price IDs (prevent accidental mismatch).
- Monthly/annual credit grants, trial credits, top-up packs, currency display.
- Feature release state, minimum tier, tool description, credit coefficient, resolution and concurrency.
- Provider/model routing and fallback **within verified capabilities**, max output count, cost hard-stop.
- Storage limits, user max jobs/day, unsafe-use enforcement toggles, watermark policy.
- Campaign presets and example gallery contents.

**Rule:** If changing price requires creating a new Stripe Price rather than mutating an existing one, support a safe administrative workflow and preserve existing subscribers' billing contracts unless owner chooses migration and properly notifies customers.

## 13. CLAUDE CODE WORKFLOW / DELIVERY CHECKLIST

In your first response after reading this file:

1. Summarize architecture and dependencies.
2. Write `docs/IMPLEMENTATION_PLAN.md` with checklists organized by Phase 0, Phase 1, Phase 2, Phase 3, Phase 4.
3. Create a concise repo-root `CLAUDE.md` describing commands, architecture, safety rules, and current phase (keep this large blueprint separate).
4. Implement **only Phase 0 and Phase 1** unless explicitly told to proceed.
5. Build one vertical slice at a time, including UI, route, DB/migrations, worker/provider, entitlement/credits, tests.
6. Maintain `docs/PROGRESS.md` after each slice with working features, test results, blockers and next tasks.
7. Create a well-structured `README.md`, `.env.example`, setup instructions, staging deployment instructions and provider configuration guide.
8. Before launch, require explicit signoff on provider account, billing activation, legal policies, production environment variables and cost ceilings.

### First implementation prompt (paste into Claude Code)

> Read `AI_CHARACTER_STUDIO_MASTER_BUILD.md` completely. This is the product source of truth. Create the implementation plan and concise `CLAUDE.md`, then start coding Phase 0 and Phase 1 in incremental, tested vertical slices. Preserve all 30 feature keys in a feature catalog with honest roadmap statuses. Build a real image-provider integration, private storage, auth, job queue, atomic credit ledger, Stripe test-mode subscriptions, core tools (01, 02, 03, 11), One-Click Photoshoot, Scene Director, and Character Library. Do not claim unbuilt tools work. Do not activate live charges or deploy without asking me first. At each milestone run tests, describe what works, and continue to the next scoped task.

## 14. OWNER INPUTS REQUIRED BEFORE PRODUCTION

Not blockers for scaffolding, but required for real integrations:

- Final brand name, domain, logo, preferred color scheme (default as above).
- Supabase or alternate managed database project and storage credentials.
- Image API provider account, key, models and confirmed model input capabilities.
- Stripe account, test keys, price IDs, tax configuration, payment branding, support contact.
- Deployment hosting and allowed hosting budget.
- Legal business entity, tax residence, privacy/terms/acceptable use, support email.
- Approved cost ceilings and beta user group.

## 15. SUCCESS CRITERIA

Launch is ready only when a user can sign up, consent to and securely upload their own portrait, select a genuine live feature, receive a real generated image via a paid API provider, see truthful credit usage, retrieve and delete their private assets, pay/upgrade in tested billing flows, and receive reliable support/error feedback. Admin can inspect costs and disable expensive or unsafe functionality immediately. Remaining tools are listed and can be unlocked progressively through phased engineering and entitlement configuration.

