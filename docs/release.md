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

Public packages retain the `@obsunified` scope. Add a changeset for behavior
changes, run `pnpm version-packages` in a worktree, and merge the version
changes through a PR. Authenticate to npm with scope publishing access and
run `pnpm release`. Website/docs are private workspace members and are
excluded from publishing.

The standalone Node wrapper is versioned separately: build with
`pnpm --filter @obsunified/sdk build`, then publish from `sdks/node` with
`npm publish --access public`. Check existing published versions before retrying.

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
