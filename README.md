# obs-unified-docs

Documentation site for [obs-unified](https://github.com/sawanruparel/obs-unified) — built with [Fumadocs](https://fumadocs.dev/) on React Router 7 (SPA, no Next.js).

## Running locally

```bash
pnpm install
pnpm dev
```

Site at [http://localhost:3000](http://localhost:3000).

## Editing

Markdown files live under `content/docs/`. Page order is controlled by `content/docs/meta.json`. Add a new page by creating `content/docs/<slug>.mdx` and appending the slug to `meta.json`.

Frontmatter shape:

```mdx
---
title: Page title
description: Short subtitle shown under the heading.
---
```

## Deploying

```bash
pnpm build
```

Output is a static site under `build/client/` — deploy to any static host (Cloudflare Pages, S3, Netlify, etc.). No Node server needed at runtime.
