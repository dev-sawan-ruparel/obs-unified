# Personal monorepo migration

Canonical repository: https://github.com/dev-sawan-ruparel/obs-unified.

The collector, dashboard, SDKs, CLI, MCP server, website, docs, and skills share
one repository. The five default-branch histories were imported without
squashing or rewriting original commits. Historical commits retain their
original layouts. Issue/PR discussions and repository settings are separate
from Git history.

| Component | Directory |
| --- | --- |
| Product apps | apps/collector, apps/collector-node, apps/web, apps/obs-demo |
| Marketing website | apps/website |
| Documentation | apps/docs |
| SDKs, dashboard, CLI, MCP, messaging, brand | packages, sdks |
| Agent skills | skills |
| Cloudflare deployment helpers | infra/cloudflare |

Install once with `pnpm install --frozen-lockfile`. The former dependency graphs
are preserved in one lockfile; Fumadocs is pinned to the imported versions.
`pnpm check:surfaces` verifies messaging against every consumer.

## Repository configuration

`config/project.json` defines `GITHUB_REPO_LINK`, currently
`https://github.com/dev-sawan-ruparel/obs-unified`. Website/docs navigation,
source links, structured metadata, clone commands, benchmark links, and docs
edit links use it. Set `GITHUB_REPO_LINK` in the build environment to override
it. Vite and website prerender use the same value. Current source and docs
contain no organization repository URLs. Preserved historical commits are
not rewritten.

## Deployments and releases

GitHub Actions workflows and runner tooling are removed. Validate locally and
use the independent commands in [release instructions](release.md) and
[Cloudflare deployment](../infra/cloudflare/README.md).

The website and docs use existing Cloudflare Pages projects and domains:
`pnpm deploy:website` and `pnpm deploy:docs`. Account and project names are
set in each app's Wrangler config and recorded in `config/cloudflare.json`.

Public npm names stay under `@obsunified`. Skill downloads use this repository's
`skills-v0.1.1` release. The Go module now uses
`github.com/dev-sawan-ruparel/obs-unified/sdks/go`; upgrading applications must
update imports. Container commands use `ghcr.io/dev-sawan-ruparel/local:latest`;
publishing that image is independent of source migration. Local source builds
use `pnpm local:image` and `pnpm local:run`.

The signed-in account can create the personal repository but has no write/admin
access to the former organization. Retiring its repos, organization profile,
and runner services requires an account with that access.
