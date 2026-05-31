# Contributing to obs-unified

## RFC tree

The active architecture lives in
[rfcs/0003-unified-stack.md](rfcs/0003-unified-stack.md) and its child RFCs
(0004–0009). Read the umbrella before proposing structural changes.

The implementation sequencing plan lives in
[docs/implementation/sequencing.md](docs/implementation/sequencing.md). Phase
status there is the source of truth.

## Required practices

### No orphan detail pages

**Every detail surface ships with a `<ConnectedRail />`** — RFC 0006's contract
for the unified-stack thesis.

When you add a new detail view (drawer, modal, dedicated page, etc.) for any
entity that carries identity-graph keys (`trace_id`, `session_id`,
`interaction_id`, `user_id`), it MUST render the connected rail beside it. The
rail surfaces the entity's neighbors in ≤ 1 click — without it, the detail page
is a dead end and the product's "unified" promise is broken.

Exceptions:

- Read-only summary cards that don't represent a single entity (e.g. aggregates,
  charts).
- Configuration / settings views.
- Login / onboarding flows.

If you're adding a real entity detail surface and you genuinely think it
shouldn't have a rail, write the reason in the PR description and tag a
reviewer.

### Schema seam

All collector code that touches D1 must go through the `SqlDb` interface
([packages/obs-collector/src/lib/sql-db.ts](packages/obs-collector/src/lib/sql-db.ts)).
Direct `c.env.DB.prepare(...)` calls are a regression — see RFC 0008. Use
`sqlDbFor(c.env)` at handler entry, or capture the runtime's `SqlDb` if you need
the host-injected adapter.

### Tests

- Unit tests live alongside source as `*.test.ts`.
- Use `MemSqlDb` from `packages/obs-collector/src/lib/test-utils/mem-sql-db.ts`
  for store-level tests; never hand-roll a fake.
- Run `pnpm -r run type-check` and `pnpm -r run test` before opening a PR.

## Commit style

- Conventional commits: `feat(scope):`, `fix(scope):`, `refactor(scope):`,
  `docs(scope):`, `chore(scope):`.
- Scope = the affected package or RFC area (e.g. `analytics-sdk`, `collector`,
  `dashboard`, `rfc`).
- Reference the RFC + phase in the body when relevant: _RFC 0006 Phase 3.5 —
  wire ConnectedRail into LogsDashboard._
