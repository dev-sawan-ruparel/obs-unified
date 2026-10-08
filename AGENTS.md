# Workspace conventions

This is the obs-unified product monorepo at dev-sawan-ruparel/obs-unified.

- Work in an isolated Git worktree. Do not switch branches in shared primary
  checkouts. Stage only your own files and submit changes through pull requests.
- Do not add GitHub Actions workflows or self-hosted GitHub runner tooling.
  Validate locally and deploy website/docs directly to Cloudflare Pages.
- Install Node dependencies at the root with pnpm. Do not add application lockfiles.
- Product packages remain under the public `@obsunified` npm scope.
- Edit messaging facts in `packages/messaging/manifest.json`, then run
  `pnpm messaging:generate` and `pnpm messaging:sync`. Validate with
  `pnpm check:surfaces`; do not hand-edit generated consumer manifests.
- Website and docs live in `apps/website` and `apps/docs`; agent skills in
  `skills`; Cloudflare deployment helpers in `infra/cloudflare`.
- Keep website/docs deployments, npm package releases, language SDK releases,
  and skill bundle releases independent. See `docs/monorepo-migration.md`
  for compatibility paths and required deployment settings.
