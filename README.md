# obs-unified-docs

Documentation site for [obs-unified](https://github.com/sawanruparel/obs-unified) — built with [Fumadocs](https://fumadocs.dev/) (Next.js + MDX).

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

Static export works (`next build` then deploy `.next` or `out/`). Any Next.js host (Vercel, Cloudflare Pages, self-hosted) is fine.
