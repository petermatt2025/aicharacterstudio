# AI Character Studio - Claude Code Project Instructions

Read `AI_CHARACTER_STUDIO_MASTER_BUILD.md` as the product source of truth before changing architecture or features.

## Immediate mission
- Create `docs/IMPLEMENTATION_PLAN.md` and track `docs/PROGRESS.md`.
- Implement Phase 0 then Phase 1 only, in tested working vertical slices.
- Catalog all 30 tool IDs from the blueprint. Only mark tested tools live; others stay Coming Soon or Planned.
- Do not activate real Stripe billing, publish publicly, or deploy to production without explicit owner approval.

## Engineering
- Use TypeScript and Next.js unless existing repo demands another stable choice.
- Keep API keys server-side and private image assets behind authorization.
- Use durable async jobs, validated webhooks, a transaction-safe credit ledger and idempotent processing.
- Treat reference images as private and subject to permission/consent checks.
- Check provider model capabilities against current docs before implementing.
- Use migration-based schema, strict input validation, testable provider adapter and fake only for local tests.
- Add tests for permissions, accounting, Stripe events, job failures and retries.
- Run available lint, typecheck, tests and builds after milestones; report results honestly.

## Collaboration
- Make sensible defaults and document assumptions.
- Keep output concise and implementation-focused.
- Explain required credentials only at integration stages.
- Update README, .env.example and PROGRESS as the app evolves.
