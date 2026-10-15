---
"@obsunified/cli": patch
---

Add `environment`, `serviceVersion`, and `commitSha` release-lineage config to the `hono-workers` template so AutoSRE change correlation works out of the box, and note in the CLI README that the non-interactive `create` flags require 1.1.2 or newer.
