# RFC 0012: Unified messaging — single source of truth and cross-repo parity

- **Status:** Draft
- **Author:** @sawanruparel
- **Created:** 2026-06-04
- **Updated:** 2026-06-04
- **Depends on:** none (process / infrastructure RFC)
- **Related:** [RFC 0011 — Evidence retrieval layer](0011-evidence-retrieval-layer.md)
  (worked example for feature propagation),
  [EvidenceReference contract](../docs/spec/evidence-reference.md)
- **Precedent:** `@obs-unified/brand` + `packages/brand/scripts/sync-to-projects.mjs`
- **Target:** `obs-unified`, `obs-unified-docs`, `presence`, `obs-unified-skills`,
  `@obs-unified/types`, `packages/messaging` (new)
- **Companion:** execution checklist, tracked separately (not in this RFC).

---

## Summary

Product facts about obs-unified — package names, the MCP tool list, the
`EvidenceReference` shape, the identity chain, the signal/capability list and
their shipped/partial/pending status — are **hand-restated across four
repositories and a dozen-plus surfaces**. There is no authoritative source and no
automated check, so the copies drift. This RFC proposes a **messaging manifest**
(one machine-readable source, derived from code wherever the fact already lives
in code), a **sync/generation step** that pushes derived values into each
surface, and **CI parity gates** in every repo that fail a PR when a surface
diverges. It also defines how a **new feature** (e.g. the RFC 0011 evidence
retrieval / CCR layer) propagates into messaging by construction.

The goal is not to template marketing prose. It is to make the small set of
*enumerable, verifiable facts* single-sourced, and to make "ship a feature"
include "the feature is described, consistently and accurately, on every surface
that should mention it — and on none that shouldn't yet."

## Motivation

Two independent reviews (2026-06-03 messaging review + its verification report)
found the same failure mode **recurring**:

- **Incident A — MCP surface drift.** `get_profile`/`get_eval` were added and the
  package moved scope/registry (`@obs-unified/mcp-server` on GitHub Packages →
  `@obsunified/mcp-server` on public npm). Lead repo + docs-site were updated;
  `presence` and the skills repo lagged in separate cycles.
- **Incident B — contract field drift.** `suggestedPivots` → `suggestedNextPivots`
  was corrected in `@obs-unified/types`, the spec, and docs-site, but the
  **skills** repo kept the old field name and was fixed only in a later PR.

Both were caught only by manual review. Residual drift still open today
(verification report): **M2** (dev ingest key `"dev"` vs `dev-ingest-key`) and
**M4** (`doctor` invocation style). Same class of fact, same hand-copy problem.

The skills repo is the consistent laggard because it is furthest from the code
that defines the contract. As we add features (next: the evidence retrieval /
CCR layer), this gets worse without a system.

## Today

### What exists (and is good)
- Contracts already live in **code**: `@obs-unified/types`
  (`EvidenceReferenceJsonSchema`, governance enums), the MCP tool registration in
  `packages/mcp-server/src`, package identity in each `package.json`.
- A spec layer: `docs/spec/evidence-reference.md`.
- A **cross-repo sync precedent**: `@obs-unified/brand` +
  `packages/brand/scripts/sync-to-projects.mjs`.
- `presence` already centralized prose into `src/content/site.json`.

### Gaps
- No single source for enumerable facts; every surface hand-copies them.
- No derivation from code, so even the lead repo restates tool/field names by hand
  (where Incidents A/B originated).
- No CI gate comparing surfaces to an authority — drift fails only at human review.
- Two status trackers (`rfc-status.md`, `ai-debugging-impact-backlog.md`) can
  disagree, with nothing enforcing agreement.
- No defined path for getting a *new* feature onto every surface (and off the
  surfaces it shouldn't reach while still Draft).

## Surfaces (interface inventory)

Messaging governance must be explicit about **every place a human or agent meets
a fact**. The inventory below is the authoritative list the parity checks cover.
"Governance" is how each surface stays correct: **code** = authority of record,
**gen** = written by the generator, **sync** = vendored/pushed from the manifest,
**check** = grepped against the manifest in CI, **prose** = hand-written voice
(not governed, but its embedded facts are `check`ed).

### GitHub (developer + contributor entry points)
| Surface | Location | Carries | Governance |
| --- | --- | --- | --- |
| **Org profile README** | `github.com/obs-unified` (`.github` repo) | display name, tagline, signal/capability list, primary links | prose + check |
| **Root README** | `obs-unified/README.md` | install, "What you get", MCP tool list, package names, deploy paths | check + gen snippets |
| **Per-package READMEs** | `packages/*/README.md` (also render on the registry page) | package name, install command, tool list, field names | check |
| **Repo "About" + topics** | GitHub repo metadata | tagline, keywords/topics | check |
| **CHANGELOGs / Releases** | `packages/*/CHANGELOG.md`, GitHub Releases | version, what shipped, status transitions | prose (links status) |
| **Issue/PR templates** | `.github/` | e.g. comparison-correction flow | prose |

### Package registries (install-time truth)
| Surface | Location | Carries | Governance |
| --- | --- | --- | --- |
| **npm package page** | npmjs.com/`@obsunified/mcp-server` | renders package README + `package.json` description/keywords | derived from package README + `package.json` |
| **GitHub Packages pages** | `@obs-unified/*` (SDKs, collector, types, dashboard) | same, on GitHub Packages | derived |
| **`package.json` description/keywords** | each package | one-liner, search keywords, scope/registry | check |

### Website — `presence` / obsunified.com (buyer + evaluator)
| Surface | Location | Carries | Governance |
| --- | --- | --- | --- |
| **Landing copy** | `src/content/site.json` (hero/features/architecture/compare/faq) | capability list, tool list, identity chain, package names | gen (facts) + prose (voice) |
| **HTML meta / OG / Twitter** | `index.html` | title, description, social cards | gen from `seo` |
| **JSON-LD** | `src/schema.ts` (`SoftwareApplication.featureList`) | capability/feature list, description | gen |
| **llms.txt** | `public/llms.txt` | signal types, tool list, identity chain, install, "key answers" | gen + prose |
| **Screenshots/alt text** | `public/screenshots/*` | feature names in alt text | prose |

### Docs — `obs-unified-docs` / docs.obsunified.com (dev + agent)
| Surface | Location | Carries | Governance |
| --- | --- | --- | --- |
| **Docs pages** | `content/docs/*.mdx` (mcp-server, evidence-reference, agent-action-graph, sdks, getting-started, what-to-expect, comparison, instrumenting, …) | install, tool list, field names, capabilities, scenarios | check + sync (vendored manifest) |
| **Docs index nav** | `content/docs/index.mdx` | page list (discoverability) | check |

### Agent / runtime (the contract surfaces — usually the authority)
| Surface | Location | Carries | Governance |
| --- | --- | --- | --- |
| **MCP tool names + descriptions** | `packages/mcp-server/src` | the canonical tool list | **code (authority)** |
| **ToolResponseContract + EvidenceReference output** | collector responses, `@obs-unified/types` | field names, schema version | **code (authority)** |
| **CLI `--help` / `doctor`** | `@obs-unified/cli` | command/flag names | **code (authority)** |
| **Skills** | `obs-unified-skills/*/SKILL.md` (frontmatter description **and** body) | trigger phrasing, tool names, endpoints, field names | prose (description) + check (facts) |

### Design / contributor
| Surface | Location | Carries | Governance |
| --- | --- | --- | --- |
| **Specs** | `docs/spec/*` | contract definitions | authority/prose |
| **RFCs + status** | `rfcs/*`, `rfc-status.md`, backlog | design, capability status | status-of-record |

> The **skills frontmatter description** is itself a messaging surface (it
> controls when Claude triggers the skill) and is the most frequently missed.

## Definitions

- **Fact:** an enumerable, verifiable statement that must be identical everywhere
  it appears (package name, tool name, field name, identity-chain string, a
  capability's status). *Not* voice or narrative.
- **Authority:** the one place a fact is defined. Prefer **code**; fall back to a
  hand-authored manifest entry only when no code authority exists.
- **Manifest:** `packages/messaging/manifest.json` — assembled facts; code-derived
  facts written by the generator, the rest hand-authored.
- **Surface:** any entry in the inventory above.
- **Parity check:** a non-mutating CI step that fails when a surface disagrees
  with the manifest.
- **Feature record:** a manifest entry describing one product feature and the
  surfaces it must (and must not yet) appear on — see below.

## Proposal

### 1. The messaging manifest (`packages/messaging/`)
```
packages/messaging/
  manifest.json          # assembled facts (generated + hand-authored)
  generate.mjs           # derive code-known facts INTO manifest.json
  sync-to-projects.mjs   # write derived snippets/constants into satellites
  check.mjs              # non-mutating parity check (CI entry point)
  README.md              # update workflow + authority table
```

Facts and authorities:

| Fact | Authority | Generated? |
| --- | --- | --- |
| MCP tool names | `packages/mcp-server/src` registration | yes |
| `EvidenceReference` fields + JSON schema | `@obs-unified/types` | yes |
| Package names / scopes / registries | each `package.json` | yes |
| Connected `kind` enum | collector route source | yes |
| Governance enums (`autonomyLevel`/`approvalState`/`sideEffect`) | `@obs-unified/types` | yes |
| Identity chain string | manifest (hand) | no |
| Capability + status (`planned`/`preview`/`shipped`) | status-of-record | no |
| **Feature records** | manifest (hand) + cross-checked vs code | partly |
| Glossary (display name vs slug, scope note, dev keys) | manifest (hand) | no |

### 2. Generation + sync (reuse the brand pattern)
- `pnpm messaging:generate` → rewrites code-derived sections of `manifest.json`;
  CI fails if regenerating produces a diff (forces regen on any tool/field/scope
  change).
- `pnpm messaging:sync` → writes generated artifacts into consumers
  (`presence/src/content/messaging.generated.ts`; vendored `manifest.json` +
  partials in docs-site and skills).

### 3. CI parity gates (self-hosted runners only)
- Lead repo: `messaging:generate --check` + `messaging:check`.
- Each satellite: a `messaging:check` job (surfaces vs vendored manifest).
- `runs-on: [self-hosted, <label>]`; `pnpm/action-setup@v4` with no `version:`.

### 4. Skills lint (smallest, highest-value slice — ship first)
Assert every backticked `EvidenceReference`-looking field token, every MCP tool
name, and every `@obs…/…` package name in `SKILL.md` is a manifest member.
Catches both prior incidents at the laggard repo.

### 5. Collapse the two status trackers (kills the H3 class)
Pick one **status-of-record** (recommend `rfc-status.md`); the backlog becomes a
work queue referencing it. Capability+status in the manifest derives from the
status-of-record; README / `site.json` featureList / `llms.txt` derive from the
manifest — enabling honest `planned`/`preview`/`shipped` badges.

## Feature onboarding: propagating a new feature to every surface

This is the part that makes the system durable as the product grows. A feature is
not "done" when the code merges; it is done when it is described correctly on
every surface that should mention it — and absent from surfaces it shouldn't reach
while still in draft. We model this with a **feature record** and a fixed
lifecycle.

### The `feature` record (in `manifest.json`)
```jsonc
{
  "id": "evidence-retrieval",
  "displayName": "Evidence retrieval (compressed context retrieval)",
  "glossary": ["CCR", "compressed context retrieval", "evidence bundle"],
  "status": "planned",                 // planned | preview | shipped
  "rfc": "0011-evidence-retrieval-layer",
  "docsSlug": "/docs/evidence-retrieval",
  "addsMcpTools": ["retrieve_evidence"],     // declared; must match code when shipped
  "addsEntityKinds": ["evidence_bundle"],    // EvidenceReference additions
  "addsEvidenceFields": [],
  "addsSignalType": "Evidence retrieval",
  "surfacesWhenShipped": [
    "readme.what-you-get", "site.features", "llms.signal-types",
    "jsonld.featureList", "docs.index", "docs.page", "skills.tool-list"
  ]
}
```

### Lifecycle (RFC → every surface)
1. **Design.** RFC drafted (e.g. RFC 0011, CCR). A feature record is added with
   `status: planned`. The parity gate **forbids** any surface from describing it
   as shipped while `planned` — this is how we avoid the overclaim class the
   original review flagged (Scenario A/C, "ships X" when partial).
2. **Declare.** The feature record names the tools/entity-kinds/fields/signal it
   will add and the surfaces it must reach when shipped.
3. **Build.** The contract lands in code authorities (`@obs-unified/types` for new
   entity kinds/fields; `packages/mcp-server/src` for new tools; collector routes).
4. **Generate.** `messaging:generate` auto-picks the new tools/fields/kinds into
   the manifest **and cross-checks them against the feature record**:
   - a tool/field appears in code but no feature declares it → **orphan, fail**;
   - a feature declares a tool/field that code doesn't expose → **gap, fail**.
5. **Sync.** `messaging:sync` fans the feature out to its declared surfaces
   (README row, website card, llms.txt signal, JSON-LD featureList, docs page +
   index link, glossary term, skills tool/field references).
6. **Promote.** Flipping `status` to `preview` then `shipped` in the
   status-of-record updates the capability badge on every surface at once; once
   `shipped`, the parity gate **requires** the feature to appear on every surface
   in `surfacesWhenShipped` (missing surface → fail).
7. **Done.** Feature is "messaging-complete" only when its record is filled,
   status is set, code matches declarations, and all four repos' `messaging:check`
   pass. This clause is added to every feature's Definition of Done.

### Worked example — evidence retrieval / CCR (RFC 0011)
RFC 0011 introduces an evidence retrieval layer "inspired by
compress-cache-retrieve systems." Under this RFC, onboarding it looks like:

- **Now (RFC Draft):** add the `evidence-retrieval` feature record with
  `status: planned`. It may appear on the **roadmap/status** surfaces only. The
  gate ensures it is **not** listed in README "What you get", the website feature
  grid, `llms.txt` signal types, or JSON-LD as if it ships today.
- **When it adds an MCP tool** (say `retrieve_evidence`): the tool lands in
  `packages/mcp-server/src`; `generate` picks it into the manifest tool list;
  `sync` adds it to *every* tool-list surface (mcp-server README + `.mdx`,
  `sdks.mdx`, `site.json` feature card, `llms.txt`, root README) in one pass; the
  skills lint now accepts it. No more "added the tool, forgot four docs."
- **When it adds an `EvidenceReference` variant / entity kind** (e.g.
  `evidence_bundle`, a `retrieval` source): it lands in `@obs-unified/types`;
  `generate` updates the field/kind set; `sync` updates `evidence-reference.mdx`,
  the spec cross-references, and the skills field list. The
  `suggestedNextPivots`-style drift cannot recur.
- **When it ships:** flip `status: shipped` in the status-of-record. The website,
  README, llms.txt, JSON-LD, and docs index all gain the "Evidence retrieval"
  capability with a `shipped` badge simultaneously; the new `/docs/evidence-retrieval`
  page must exist and be linked from the index, or CI fails.
- **Glossary:** `CCR` / "compressed context retrieval" / "evidence bundle" enter
  the glossary; the glossary check ensures the terms are used consistently (not
  "CCR" in one place and "context cache" in another).

The net effect: adding a feature is a manifest edit plus code; propagation to all
~20 surfaces is mechanical and enforced, and the timing (planned → shipped) is
governed so we never overclaim a draft feature or under-document a shipped one.

## Update workflow / Definition of done
A contract/name/scope/status/feature change is "done" only when:
1. the code change lands;
2. the relevant **feature record / manifest fact** is updated;
3. `pnpm messaging:generate` is rerun;
4. `pnpm messaging:sync` is run;
5. all four `messaging:check` jobs pass.

Documented once in `packages/messaging/README.md`.

## Rollout (phased; tasks in the companion checklist)
- **P0 — stop the bleeding:** fix M2/M4; seed `manifest.json` (MCP tool list,
  `EvidenceReference` fields, package table); add the skills lint.
- **P1 — single-source volatile facts:** `generate.mjs` + `sync-to-projects.mjs`;
  presence consumes `messaging.generated.ts`; docs-site + skills vendor the
  manifest; `messaging:check` in all four repos.
- **P2 — expand coverage:** identity chain, connected kinds, governance enums,
  capability+status badges; **feature records** + orphan/gap cross-check.
- **P3 — status + glossary:** collapse the two status trackers; glossary +
  display-name/slug enforcement; full surface inventory under `check`.

## Alternatives considered
- **Publish a `@obsunified/messaging` package** the satellites depend on — cleaner
  versioning, but adds install/auth coupling and a publish step per change.
  Rejected for the existing committed-and-synced brand pattern.
- **Keep manual sweeps** — status quo; already failed twice in one review window.
- **Template all copy from data** — over-reach; couples voice to data. Only facts
  are single-sourced; voice stays in `site.json`.

## Risks / non-goals
- **Non-goal:** templating marketing/voice prose.
- **Risk:** satellite vendoring needs a sync step — mitigated by the brand
  precedent and the `--check` gate (drift fails CI, doesn't rot).
- **Risk:** generators must track code refactors — keep derivation points few,
  commented, and covered by the lead-repo `--check`.
- **Risk:** the org profile README and registry pages live partly outside the
  monorepo — covered by `check` where the source is reachable, flagged as
  manual-sync where it is not.

## Open questions
- Status-of-record: `rfc-status.md` vs the backlog — which wins?
- Is the dev ingest key (`dev-ingest-key`) a manifest fact or a one-off P0 fix?
  (Leaning: manifest fact — it appears in 4+ places.)
- Does `presence` consume `messaging.generated.ts` directly or fold it into the
  `site.json` build step?
- Do we gate the **org profile README** and **npm/GitHub Packages pages** in CI,
  or treat them as manual-sync with a periodic audit?
