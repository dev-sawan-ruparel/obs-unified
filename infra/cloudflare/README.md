# Cloudflare deployment

The monorepo deploys directly to existing Cloudflare Pages projects in the
Quoppo account. Resource IDs and domains are recorded in
[`config/cloudflare.json`](../../config/cloudflare.json), and the deploy helper selects the account through `CLOUDFLARE_ACCOUNT_ID`.
Each application's `wrangler.toml` selects the matching Pages project.

| Application | Pages project | Domain | Command from the root |
| --- | --- | --- | --- |
| Website | obsunified | obsunified.com, www.obsunified.com | pnpm deploy:website |
| Docs | obsunified-docs | docs.obsunified.com | pnpm deploy:docs |

Authenticate with `wrangler login`, or provide `CLOUDFLARE_API_TOKEN` with
Pages edit access. Both projects are Direct Upload projects. GitHub Actions
and GitHub runner services are not used. A GitHub push alone does not deploy;
run the corresponding deploy command after the change is merged.

`GITHUB_REPO_LINK` is public build configuration shared by both apps. Its
default is in `config/project.json`; it is also recorded in each Pages
project's production and preview environment settings. Direct-upload builds
read local configuration or environment overrides because they run locally.

The existing DNS CNAMEs already point to these projects. The scripts in
`scripts/` support inspecting credentials and repairing DNS if needed. They
read an ignored `.env.deploy`; use `.env.deploy.example` as a starting point.

No standalone obs-unified collector Worker, D1 database, or R2 buckets were
found in this account. Other applications' observability resources are not
bound to this repository. The collector configuration remains a local demo;
a production collector deployment is a separate operation.
