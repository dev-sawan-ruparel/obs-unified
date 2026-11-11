# Releases

Releases run from the personal monorepo. GitHub Actions and GitHub runner
services are not used.

## Validate locally

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm check:surfaces
pnpm -r --sort --filter '!presence' --filter '!obs-unified-docs' build
pnpm -r --filter '!presence' --filter '!obs-unified-docs' type-check
pnpm -r --filter '!presence' --filter '!obs-unified-docs' test
pnpm --filter presence types:check
pnpm --filter obs-unified-docs types:check
pnpm build:website
pnpm build:docs
make -C skills lint validate build
```

## One-command release

`pnpm release:all` (`scripts/release/run.sh`) chains every step below from a
clean, synced `main`: gates, the multi-arch GHCR image build and push plus
smoke test, the sequential npm publish and tag push, and the website and docs
deploys. Run it from a real terminal because npm's passkey flow prompts once
per package.

```bash
pnpm release:all                   # everything
pnpm release:all -- --dry-run      # print the plan only
pnpm release:all -- --skip-docker  # e.g. npm + deploys only
pnpm release:all -- --skills 0.1.5 # also cut skills-v0.1.5
```

Preflight also fails early when the Docker data partition has less than
10 GB free (`RELEASE_MIN_FREE_GB` overrides), and after a successful push the
script removes local copies of earlier release images and trims the build
cache, since those are what fill the partition over time.

It refuses to run with unversioned changesets (run `pnpm changeset version`
in a PR first), and every stage is idempotent: an image tag already on GHCR,
a package version already on npm, or an existing skills release is skipped,
so re-running after an interruption resumes where it stopped. After a
`--skills` release, update the documented download tag in a follow-up PR.

## npm packages

Public packages retain the `@obsunified` scope. **Every PR that changes a
published package (source, templates, README shipped in the tarball, or
dependencies) must include a changeset** (`pnpm changeset`); do not hand-edit
package versions or changelogs. PR #32 was hand-versioned instead, which
bypassed `pnpm version-packages` and is the failure this rule prevents. Add a
changeset for behavior
changes, run `pnpm version-packages` in a worktree, and merge the version
changes through a PR. Website/docs are private workspace members and are
excluded from publishing.

When `pnpm version-packages` bumps `@obsunified/analytics-sdk` or
`@obsunified/telemetry-sdk`, also bump the caret ranges in
`packages/cli/src/scaffold-versions.ts` and `packages/cli/templates/*/package.json`
to the new version; `packages/cli/src/scaffold-versions.test.ts` fails until the
scaffold pins match the workspace exactly.

Publish from a normal interactive terminal on `main`:

```bash
npm login                  # once per machine; the token in ~/.npmrc expires
pnpm release -- --dry-run  # every check plus build and pack; publishes nothing
pnpm release               # same checks, a confirmation prompt, then publish
```

`pnpm release` runs `scripts/release-npm/publish.mjs`
(`scripts/release-npm/publish-sequential.sh` is a wrapper for it). It fails
closed, exiting non-zero, at the first problem:

1. **Preflight.** It must run on `main` with a clean tracked tree, no
   untracked files inside package directories, HEAD equal to `origin/main`,
   no unversioned changesets, the public npm registry, an npm login, and an
   interactive TTY.
2. **Plan.** The publish order comes from each package's runtime and peer
   dependencies, plus the SDK ranges the CLI writes into scaffolded apps, so
   the SDKs always publish before the CLI. Those scaffold pins must equal
   `^<workspace version>`, and a local version below npm's latest is refused.
3. **Build and pack.** It runs `pnpm build:packages`, fails if the build
   changed tracked files, then packs each package and checks the tarball: the
   name and version match, no `workspace:` ranges remain, internal ranges
   match the workspace, every `main`/`types`/`bin`/`exports` target exists,
   and no `.env`, `.npmrc` or nested tarballs are included.
4. **Publish.** It publishes the verified tarball itself, one package at a
   time. It stops at the first failure and waits for each version to appear
   on the registry before publishing its dependents.
5. **Tags and verification.** It runs `changeset tag`, pushes only the new
   tags, then installs every published version from npm into a scratch
   project and checks `obs-unified --version`.

Versions already on npm are skipped, so re-run after an interruption.

The script publishes sequentially rather than through `changeset publish`,
for two reasons:

- `changeset publish` publishes in parallel, and each `prepublishOnly`
  rebuilds with tsup (`clean: true`). One package's `dist/` can be wiped
  while a dependent is still bundling against it.
- The npm account uses 2FA in "auth-and-writes" mode with a passkey. There is
  no TOTP code to pass with `--otp`; npm opens one browser prompt per publish
  and needs an interactive TTY. The Claude Code `!` shell is not a TTY.

`@obsunified/sdk` (`sdks/node`) is part of the workspace and is included in the
sequence; it does not need a separate `npm publish`.

## Go SDK

The module is `github.com/dev-sawan-ruparel/obs-unified/sdks/go`.
Run `go vet ./...`, `go test ./...`, and `go build ./...` in `sdks/go`, then
create an annotated `sdks/go/v<version>` tag on the verified commit and push
it to the personal repository. Verify with:

```bash
go list -m -versions github.com/dev-sawan-ruparel/obs-unified/sdks/go
```

Applications upgrading from the previous module identity must update imports.

## Rust SDK

Run `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`,
`cargo test --all-features`, and `cargo package` in `sdks/rust`.
`cargo publish` requires crates.io access to the existing `obs-unified` crate.

## Agent skills

Run `make -C skills lint validate build`. Create a release using a distinct
`skills-v<version>` tag and attach `skills/dist/*.skill` with `gh release create`
or `gh release upload`. Update the documented download tag when shipping new
bundles. The migration release was `skills-v0.1.1`; the current bundle is `skills-v0.1.5` (2026-11-10).

## Container image

Prebuilt multi-stage Docker images are published manually to
`ghcr.io/dev-sawan-ruparel/obs-unified` as an evaluation and small self-host
path. (For production operations, see the standalone Node collector in
[`apps/collector-node`](../apps/collector-node/README.md) backed by external
PostgreSQL and S3, documented in [Production Operations](ops/production.md)).
GitHub Actions and runners are not used.

1. Build and tag the release image locally:
   ```bash
   pnpm docker:build
   ```
2. Validate the built image with the smoke test suite:
   ```bash
   pnpm docker:smoke
   ```
3. Authenticate to GHCR using an existing `gh` session or standard docker login:
   ```bash
   gh auth token | docker login ghcr.io -u <github-username> --password-stdin
   ```
4. Push the tagged release images (`:<version>`, `:sha-<sha>`, `:latest`):
   ```bash
   docker push ghcr.io/dev-sawan-ruparel/obs-unified:<version>
   docker push ghcr.io/dev-sawan-ruparel/obs-unified:sha-<sha>
   docker push ghcr.io/dev-sawan-ruparel/obs-unified:latest
   ```
5. On initial publish, ensure package visibility is set to Public in GitHub package settings and verify anonymous pull.

For zero-config local development and demo testing, use `pnpm local:image` and `pnpm local:run`.
For complete runtime architecture, fail-closed runtime credential requirements, and rollback procedures, see the [Docker Release Guide](ops/docker-release.md).

## Website and docs

Run `pnpm deploy:website` or `pnpm deploy:docs` after validation. These build
locally and upload to existing Cloudflare Pages projects. See
[Cloudflare deployment](../infra/cloudflare/README.md).
