# Migrating from the `@obs/*` scope

The pre-1.0 packages lived under the npm scope `@obs/*`. Starting with the first
public release, every package is under `@obsunified/*`. The mapping is
mechanical — there were no API changes paired with the rename.

## Scope mapping

| Before               | After                        |
| -------------------- | ---------------------------- |
| `@obs/analytics-sdk` | `@obsunified/analytics-sdk` |
| `@obs/telemetry-sdk` | `@obsunified/telemetry-sdk` |
| `@obs/types`         | `@obsunified/types`         |
| `@obs/collector`     | `@obsunified/collector`     |
| `@obs/pprof-decoder` | `@obsunified/pprof-decoder` |
| `@obs/dashboard`     | `@obsunified/dashboard`     |

## Codemod

```bash
# From your project root
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" \) \
  -not -path "*/node_modules/*" \
  -exec sed -i '' 's|@obs/|@obsunified/|g' {} \;
```

(Linux: drop the empty argument after `-i`.)

Then re-install:

```bash
pnpm install
```

## Why the rename

The `@obs` npm scope was never registered for obs-unified — it would have
shipped under a different owner. `@obsunified/*` aligns with the GitHub
repository name and the `obs-unified-docs` sibling.

## Workers wrappers moved

`wrapD1`, `wrapR2`, `wrapFetch` previously lived at the top level of
`@obs/telemetry-sdk`. They now live at `@obsunified/telemetry-sdk/cloudflare`
so Node consumers don't pull `@cloudflare/workers-types`:

```diff
- import { wrapD1, wrapR2 } from "@obs/telemetry-sdk";
+ import { wrapD1, wrapR2 } from "@obsunified/telemetry-sdk/cloudflare";
```

All other exports stayed at the root.
