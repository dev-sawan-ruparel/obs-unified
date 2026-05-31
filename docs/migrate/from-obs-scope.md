# Migrating from the `@obs/*` scope

The pre-1.0 packages lived under the npm scope `@obs/*`. Starting with the first
public release, every package is under `@obs-unified/*`. The mapping is
mechanical — there were no API changes paired with the rename.

## Scope mapping

| Before               | After                        |
| -------------------- | ---------------------------- |
| `@obs/analytics-sdk` | `@obs-unified/analytics-sdk` |
| `@obs/telemetry-sdk` | `@obs-unified/telemetry-sdk` |
| `@obs/types`         | `@obs-unified/types`         |
| `@obs/collector`     | `@obs-unified/collector`     |
| `@obs/pprof-decoder` | `@obs-unified/pprof-decoder` |
| `@obs/dashboard`     | `@obs-unified/dashboard`     |

## Codemod

```bash
# From your project root
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" \) \
  -not -path "*/node_modules/*" \
  -exec sed -i '' 's|@obs/|@obs-unified/|g' {} \;
```

(Linux: drop the empty argument after `-i`.)

Then re-install:

```bash
pnpm install
```

## Why the rename

The `@obs` npm scope was never registered for obs-unified — it would have
shipped under a different owner. `@obs-unified/*` aligns with the GitHub
repository name and the `obs-unified-docs` sibling.

## Workers wrappers moved

`wrapD1`, `wrapR2`, `wrapFetch` previously lived at the top level of
`@obs/telemetry-sdk`. They now live at `@obs-unified/telemetry-sdk/cloudflare`
so Node consumers don't pull `@cloudflare/workers-types`:

```diff
- import { wrapD1, wrapR2 } from "@obs/telemetry-sdk";
+ import { wrapD1, wrapR2 } from "@obs-unified/telemetry-sdk/cloudflare";
```

All other exports stayed at the root.
