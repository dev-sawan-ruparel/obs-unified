# Deploy website

From the monorepo root run `pnpm deploy:website`. This builds locally and
uploads `apps/website/dist` to the existing `obsunified` Cloudflare Pages project,
serving obsunified.com and www.obsunified.com.

The account ID is loaded from `config/cloudflare.json` by the deploy helper. Authenticate with `wrangler login` or
`CLOUDFLARE_API_TOKEN` with Pages edit access. `GITHUB_REPO_LINK` defaults to
`config/project.json` and supports a build environment override.

GitHub Actions is not used. Git pushes alone do not deploy Direct Upload
projects. See [Cloudflare deployment](../../infra/cloudflare/README.md).
