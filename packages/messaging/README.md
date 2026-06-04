# @obs-unified/messaging

Single source of truth for obs-unified **messaging facts** (RFC 0012): package
names/scopes, the MCP tool list, the `EvidenceReference` / `EvidenceRetrievalRef`
field sets, connected-rail kinds, governance enums, the identity chain,
capabilities + status, glossary, and feature records.

The problem this solves: those facts are restated across the README, docs site,
website, llms.txt, and skills, and they drift (the `@obsunified` scope move and
`suggestedNextPivots` both lagged in satellite repos; CCR's four new tools lagged
the docs site). This package makes the enumerable facts single-sourced and
**enforces parity in CI**.

## Files

- `manifest.json` — the assembled facts. The `derived` block is machine-written
  from code; the `authored` block is hand-maintained.
- `scripts/lib.mjs` — extractors (derive facts from code).
- `scripts/generate.mjs` — rewrite the `derived` block; `--check` fails if stale.
- `scripts/check.mjs` — fail when a lead-repo surface disagrees with the manifest.
- `scripts/sync-to-projects.mjs` — vendor the manifest into sibling repos
  (docs / presence / skills); `--check` fails if a vendored copy is stale.

## Commands (from repo root)

```bash
pnpm messaging:generate        # rewrite manifest.json derived block from code
pnpm messaging:generate:check  # CI: fail if manifest is stale vs code
pnpm messaging:check           # CI: fail if a lead surface drifted from manifest
pnpm messaging:sync            # vendor the manifest into sibling repos
```

## Authority map

| Fact | Authority (where it's defined) | In manifest |
| --- | --- | --- |
| MCP tool names | `packages/mcp-server/src` registrations | `derived.mcpTools` |
| Connected-rail kinds | `connected_signals` enum | `derived.connectedKinds` |
| `EvidenceReference` fields | `@obs-unified/types` JSON schema | `derived.evidenceReferenceFields` |
| `EvidenceRetrievalRef` fields / kinds | `@obs-unified/types` | `derived.evidenceRetrieval*` |
| Package names / registries | each `package.json` | `derived.packages` |
| Identity chain, governance enums, glossary, capabilities, features | hand-authored | `authored.*` |

## Update workflow (the contract)

A contract / name / scope / status / feature change is done only when:

1. the code change lands;
2. the relevant `authored` fact / feature record is updated (if any);
3. `pnpm messaging:generate` is rerun (manifest updated);
4. `pnpm messaging:sync` is run (siblings updated);
5. `pnpm messaging:check` and every satellite's `messaging:check` pass.

## Feature records

Each shipped feature has a record in `authored.features` declaring the MCP tools,
evidence fields, signal type, docs slug, and `surfacesWhenShipped` it adds.
`check.mjs` enforces gap (a feature declaring a tool that doesn't exist) and
orphan (an evidence tool in code that no feature owns), and the status field
governs whether a feature may appear on user-facing surfaces yet.
