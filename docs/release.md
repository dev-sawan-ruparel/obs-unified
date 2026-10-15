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

Publish from a normal interactive terminal on `main`:

```bash
npm login        # once per machine; the token in ~/.npmrc expires
pnpm release     # builds, then runs scripts/release-npm/publish-sequential.sh
git push origin --tags
```

`pnpm release` publishes the packages one at a time in dependency order rather
than through `changeset publish`, for two reasons:

- `changeset publish` runs every `pnpm publish` in parallel. Each package's
  `prepublishOnly` rebuilds with tsup (`clean: true`), so a dependency's
  `dist/` can be wiped while a dependent is still bundling against it.
- The npm account uses 2FA in "auth-and-writes" mode with a passkey. There is
  no TOTP code to pass with `--otp`; npm opens a browser prompt per publish and
  needs an interactive TTY. Twelve parallel prompts are unusable, and the
  Claude Code `!` shell is not a TTY.

The script skips any package whose local version is already on the registry,
so re-run it after an interrupted publish. Once every package is published it
runs `changeset tag`; push the tags afterwards. Registry read replicas can lag
a minute or two behind a publish, so a `npm view` immediately afterwards may
still show the previous version.

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
bundles. The migration release is `skills-v0.1.1`.

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
