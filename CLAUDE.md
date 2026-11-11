# AI Character Studio — Claude Code Project Instructions

Product source of truth: `AI_CHARACTER_STUDIO_MASTER_BUILD.md`. Plan: `docs/IMPLEMENTATION_PLAN.md`. Status: `docs/PROGRESS.md`.

## Current phase
Phase 0 and Phase 1 implemented and tested with fake provider + Stripe mock. **Do not start Phase 2 without owner approval.**
Never activate real Stripe billing (`STRIPE_ALLOW_LIVE_MODE`), publish publicly, or deploy to production without explicit owner approval.

## Commands
- `npm run dev` (web) + `npm run worker` (generation worker; separate process)
- `npm run db:migrate` / `npm run db:seed` (seed only inserts missing rows; never overwrites admin edits)
- `npm run admin:grant -- you@example.com` (admin + beta allowlist)
- `npm run check` = lint + typecheck + unit/integration tests (needs Postgres; `TEST_DATABASE_URL`, default `postgres://postgres@localhost:5432/acs_test`)
- `npm run build && npm run test:e2e` (Phase-1 gate in a real browser; Stripe API mocked locally, fake image provider)

## Architecture (src/)
- `server/` — all business logic, `import "server-only"`. Route handlers in `app/api/**` are thin wrappers using `route()` from `server/http.ts`.
- `server/credits.ts` — ledger. Grants are buckets; reserve deducts per bucket, settle charges delivered outputs, release returns the rest. Always lock the wallet row first.
- `server/generation.ts` — quote (immutable snapshot) → `createJob` (one transaction: wallet lock, checks, job row, reservation). `server/jobs.ts` — worker claim (`SKIP LOCKED` + lease), per-output idempotent processing, retries, settlement.
- `server/providers/` — `ImageProvider` contract, OpenAI adapter, capability map (verify against current docs before changing models), fake provider (tests/e2e only).
- `server/billing.ts` — Stripe checkout/portal, signed + idempotent webhooks. Credits only on `invoice.paid` / `payment_intent.succeeded`.
- `server/entitlements.ts` — the single feature gate (`featureAccess`). Tools without an implementation in `lib/tools.ts` can never run.
- `lib/catalog.ts` — 30 tools + plans + credit rules seed. `lib/tools.ts` — implemented tool definitions.

## Safety rules
- Keys server-side only; never log secrets, signed URLs or image bytes. Images only via `/api/assets/:id/file` (ownership-checked).
- Every upload requires a consent statement; character references must be `character`-kind uploads.
- Mark a tool `live` only after its real-provider end-to-end test passes. New tools need: page, provider job, quote, tests (happy + failure path), server-side gate.
- Add tests for any change to credits, billing, permissions or job processing. Report failing tests honestly.
