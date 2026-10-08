# Deploying obs-unified-docs

The docs are a React Router 7 SPA bundled by Vite. Static output is served from **Cloudflare Pages** at `docs.obsunified.com`.

## One-time setup

### Option A — Pages dashboard (recommended)

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick `obs-unified/obs-unified-docs`. Cloudflare reads `wrangler.toml` and pre-fills:
   - **Build command:** `pnpm install --frozen-lockfile && pnpm build`
   - **Build output directory:** `build/client`
   - **Root directory:** `/`
4. **Production branch:** `main`.
5. Deploy. Cloudflare auto-deploys on every push to `main` and previews every PR.

### Option B — CLI deploys

```bash
pnpm install
pnpm build
npx wrangler pages deploy ./build/client --project-name=obs-unified-docs
```

## Custom domain — docs.obsunified.com

1. Cloudflare dashboard → **Pages → obs-unified-docs → Custom domains → Add**.
2. Add `docs.obsunified.com`.
3. DNS via Cloudflare: a `CNAME` record `docs` → `obs-unified-docs.pages.dev` is created automatically.
4. SSL is issued automatically.

## SPA routing

React Router 7 handles client-side routing. Cloudflare Pages serves any unknown path by falling back to `index.html` automatically when no static asset matches — no `_redirects` rules required.

## CI

`.github/workflows/build.yml` runs on a self-hosted runner registered via `../ci/scripts/register.sh obs-unified-docs`. It runs `types:check` (which includes `react-router typegen` and `fumadocs-mdx`) and `build`, then uploads `build/` as an artifact.
