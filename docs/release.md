# Public Release Checklist

Use this checklist before merging substantial public-facing changes to `main`.

## Source readiness

- `main` has been fetched from GitHub and the branch is not behind
  `origin/main`.
- Local-only development artifacts are not staged. In this repo,
  `.claude/skills/`, `node_modules/`, build outputs, Playwright reports, and
  runtime logs are ignored.
- Every changed publishable package has a Changesets entry.
- Public package manifests include `description`, `license`, `repository`,
  `files`, `exports`, and `publishConfig` where appropriate.
- README install instructions and package READMEs match the current package
  names and registry behavior.

## Verification

Run the same checks CI expects:

```bash
pnpm install --frozen-lockfile
pnpm -r run type-check
pnpm -r run test
pnpm -r run build
pnpm run lint
```

For SDK changes, also run:

```bash
cd sdks/go && go vet ./... && go test ./... && go build ./...
cd ../rust && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test --all-features && cargo package
```

For collector runtime changes, run at least one live smoke path:

```bash
pnpm smoke:local-image
pnpm e2e:otlp
pnpm e2e:alerts
```

## Publishing flow

Packages publish from the `Release` workflow on pushes to `main`. The workflow
runs Changesets, opens or updates the release PR, and publishes after the
generated release PR is merged. Public JavaScript packages publish to npmjs so
developers can install them without GitHub Packages authentication.

The MCP server also publishes to npmjs from the `Publish MCP` workflow. It uses
the public hyphen-less npm scope, `@obsunified/mcp-server`.

The Rust SDK publishes from the `Publish Rust SDK` workflow. It validates,
packages, and publishes the `sdks/rust` crate version from `Cargo.toml` to
crates.io as `obs-unified`. It requires the `CARGO_REGISTRY_TOKEN` secret. For a
manual dry run, dispatch the workflow with `dry_run=true`; to publish from a
tag, push a tag like `rust-sdk-v0.1.0` after the version in `Cargo.toml` is
correct.

The Go SDK does not publish to a package registry. Go modules are distributed
from public Git tags. Dispatch the `Publish Go SDK` workflow with a semver
version such as `0.1.0`; it validates the module, creates the required
subdirectory tag `sdks/go/v0.1.0`, pushes it, and warms the public Go proxy so
`go get github.com/obs-unified/obs-unified/sdks/go@latest` works cleanly.

The all-in-one local image publishes from the `Publish all-in-one image`
workflow on pushes to `main`, tags, and manual dispatch. It requires
`packages: write` and should use the `OBS_UNIFIED_PACKAGES_TOKEN` secret when
the default repo token cannot administer org packages. The workflow verifies
anonymous `docker manifest inspect ghcr.io/obs-unified/local:latest` after
setting visibility to public.

Before merging the release PR:

- Confirm the generated changelogs describe the user-visible changes.
- Confirm the package versions are intentional.
- Confirm `NPM_TOKEN` is available before merging a release PR that publishes
  public npm packages.
- Confirm `CARGO_REGISTRY_TOKEN` is available before publishing the Rust SDK to
  crates.io.
- Confirm `OBS_UNIFIED_PACKAGES_TOKEN` is available when publishing or making
  the public GHCR image visible requires a token beyond `GITHUB_TOKEN`.

## Post-release

- Install public packages from a clean project without registry overrides:
  `pnpm add @obs-unified/telemetry-sdk @obs-unified/analytics-sdk`.
- Install the MCP server: `pnpm add -g @obsunified/mcp-server`.
- Install the Rust SDK: `cargo add obs-unified`.
- Install the Go SDK:
  `go get github.com/obs-unified/obs-unified/sdks/go@latest`.
- Pull the all-in-one image anonymously:
  `docker manifest inspect ghcr.io/obs-unified/local:latest`.
- Smoke-test the collector health endpoint, dashboard login, and at least one
  SDK ingest path.
- Check npmjs for `@obs-unified/*` packages and `@obsunified/mcp-server`.
- Check crates.io for `obs-unified`.
- Check the public Go proxy:
  `go list -m -versions github.com/obs-unified/obs-unified/sdks/go`.
