# obs-unified-docs

Documentation site for [obs-unified](https://github.com/obs-unified/obs-unified) — the self-hosted observability platform. Live at **[docs.obsunified.com](https://docs.obsunified.com)**.

Built with [Fumadocs](https://fumadocs.dev/) on React Router 7 (SPA, no Next.js).

## Prerequisites

- Node.js **22 LTS or newer** (`.nvmrc` pins to 22)
- pnpm **10+**
- For deploys: [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) authenticated via `wrangler login`

## Quick start

```bash
pnpm install      # postinstall runs fumadocs-mdx
pnpm dev          # http://localhost:3000
```

## Edit content

Markdown files live under [`content/docs/`](./content/docs/). Page order is controlled by [`content/docs/meta.json`](./content/docs/meta.json). Add a new page by creating `content/docs/<slug>.mdx` and appending the slug to `meta.json`.

Frontmatter shape:

```mdx
---
title: Page title
description: Short subtitle shown under the heading.
---
```

## Build

```bash
pnpm build        # → build/client/ (static SPA)
pnpm types:check  # react-router typegen + fumadocs-mdx + tsc --noEmit
```

Output under `build/client/` deploys to any static host.

## Deploy

The site deploys to **Cloudflare Pages** (project name: `obsunified-docs`).

```bash
pnpm deploy           # build + push to main
pnpm deploy:preview   # build + push to a preview branch
```

Wrangler must be authenticated first (one-time): `wrangler login`. The Cloudflare Pages project (`obsunified-docs`) and the `docs.obsunified.com` custom domain are already configured. See [DEPLOY.md](./DEPLOY.md) for the full custom-domain + DNS walkthrough.

## Sibling projects

| Repo | What it is |
|---|---|
| [`obs-unified`](https://github.com/obs-unified/obs-unified) | The product (collector + SDKs + dashboard). Private while pre-1.0. |
| [`presence`](https://github.com/obs-unified/presence) | Landing page. Live at [obsunified.com](https://obsunified.com). |
| [`ci`](https://github.com/obs-unified/ci) | Self-hosted runners + Cloudflare deploy automation. |

See the org overview at [github.com/obs-unified](https://github.com/obs-unified).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The canonical contribution guide lives in [obs-unified/CONTRIBUTING.md](https://github.com/obs-unified/obs-unified/blob/main/CONTRIBUTING.md).
