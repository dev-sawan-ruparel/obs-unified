# Deploying presence

The site is a Vite-built static bundle deployed to **Cloudflare Pages** at `obsunified.com`.

## One-time setup

### Option A — Pages dashboard (recommended)

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick `obs-unified/presence`. Cloudflare reads `wrangler.toml` and pre-fills:
   - **Build command:** `pnpm install --frozen-lockfile && pnpm build`
   - **Build output directory:** `dist`
   - **Root directory:** `/`
4. **Environment variables:** none required for the landing page.
5. **Production branch:** `main`.
6. Deploy. Cloudflare auto-deploys on every push to `main` and previews every PR.

### Option B — CLI deploys

```bash
pnpm install
pnpm build
npx wrangler pages deploy ./dist --project-name=presence
```

The first run will create the Pages project if it doesn't exist.

## Custom domain — obsunified.com

1. Cloudflare dashboard → **Pages → presence → Custom domains → Add**.
2. Add `obsunified.com` and `www.obsunified.com`.
3. Cloudflare needs to be your DNS provider, or you add the displayed `CNAME` records at your registrar:
   - `obsunified.com` → `presence.pages.dev`
   - `www.obsunified.com` → `obsunified.com`
4. SSL is issued automatically.

## What's at the edge

`public/_headers` applies on every response:

- **CSP** — `default-src 'self'` (no third-party scripts shipped)
- **HSTS** — `max-age=31536000; includeSubDomains; preload`
- **Cache-Control** — hashed `/assets/*` immutable for a year, root HTML revalidated every 5 min
- **`X-Frame-Options: DENY`**, `Permissions-Policy` locks down sensors and payment

`public/robots.txt`, `public/sitemap.xml`, and `public/llms.txt` ship at the edge for crawlers and AI search.

## CI

`.github/workflows/build.yml` runs on a self-hosted runner registered via `../ci/scripts/register.sh presence`. It runs `types:check` and `build` and uploads `dist/` as an artifact. Cloudflare does its own build on the dashboard side — CI here is for validation, not for deploy.
