---
"@obsunified/telemetry-sdk": patch
---

Move `@opentelemetry/api` from an optional peer dependency to a regular dependency. `dist/index.js` imports it unconditionally, but optional peers are not auto-installed by npm or pnpm — so a fresh `pnpm add @obsunified/telemetry-sdk` crashed on the first `import` with `ERR_MODULE_NOT_FOUND`. The Hono and Cloudflare peers stay optional; they only gate the `./cloudflare` and agent subpath exports.
