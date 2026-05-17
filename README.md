# presence

Marketing / landing page for [obs-unified](https://github.com/obs-unified/obs-unified), the self-hosted observability platform. Live at **[obsunified.com](https://obsunified.com)**.

Vanilla TypeScript + Vite. No framework. Optimized for AEO (answer-engine optimization): JSON-LD `SoftwareApplication` + `FAQPage` schemas, semantic HTML5 landmarks, `llms.txt`, sitemap, explicit AI-crawler allowlist.

## Prerequisites

- Node.js **22 LTS or newer** (`.nvmrc` pins to 22)
- pnpm **10+**
- For deploys: [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) authenticated via `wrangler login`

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:4173
```

## Build

```bash
pnpm build        # type-check + static build to ./dist
pnpm preview      # serve ./dist locally
```

Output is ~10 KB gzipped (7 KB HTML / 3 KB CSS / 6 KB JS).

## Deploy

The site deploys to **Cloudflare Pages** (project name: `obsunified`).

```bash
pnpm deploy           # build + push to main
pnpm deploy:preview   # build + push to a preview branch
```

Wrangler must be authenticated first (one-time): `wrangler login`. The Cloudflare Pages project (`obsunified`) and the `obsunified.com` custom domain are already configured. See [DEPLOY.md](./DEPLOY.md) for the full custom-domain + DNS walkthrough.

## Structure

```
presence/
├── index.html                # head: meta, OG, Twitter, JSON-LD
├── wrangler.toml             # Cloudflare Pages config
├── DEPLOY.md                 # custom-domain + DNS setup
├── src/
│   ├── main.ts               # composes the page
│   ├── style.css             # dark theme, no framework
│   └── sections/
│       ├── header.ts
│       ├── hero.ts
│       ├── features.ts
│       ├── preview.ts
│       ├── architecture.ts
│       ├── faq.ts
│       └── footer.ts
└── public/
    ├── favicon.svg
    ├── og.jpg                # Open Graph card (1200×1200)
    ├── og.svg                # source for og.jpg
    ├── robots.txt            # explicit AI-crawler allow
    ├── sitemap.xml
    ├── llms.txt              # llms.txt spec for AI search
    └── _headers              # Cloudflare Pages cache + security headers
```

## AEO checklist

- JSON-LD: `SoftwareApplication`, `Organization`, `WebSite`, `FAQPage`
- `llms.txt` summarizing the project in long-form, answer-ready prose
- Semantic landmarks: `header`, `main`, `section[aria-labelledby]`, `footer`
- Direct factual lead sentences ("obs-unified is …") for snippet extraction
- Open Graph + Twitter cards, canonical URL
- Sitemap + robots with named AI crawlers (GPTBot, ClaudeBot, PerplexityBot…)

## Sibling projects

| Repo | What it is |
|---|---|
| [`obs-unified`](https://github.com/obs-unified/obs-unified) | The product (collector + SDKs + dashboard). Private while pre-1.0; design at [docs.obsunified.com](https://docs.obsunified.com). |
| [`obs-unified-docs`](https://github.com/obs-unified/obs-unified-docs) | Docs site. Live at [docs.obsunified.com](https://docs.obsunified.com). |
| [`ci`](https://github.com/obs-unified/ci) | Self-hosted runners + Cloudflare deploy automation. |

See the org overview at [github.com/obs-unified](https://github.com/obs-unified).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The canonical contribution guide lives in [obs-unified/CONTRIBUTING.md](https://github.com/obs-unified/obs-unified/blob/main/CONTRIBUTING.md).
