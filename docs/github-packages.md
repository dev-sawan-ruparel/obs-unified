# GitHub Packages

Most TypeScript SDK packages publish to GitHub Packages under the `@obs-unified`
scope:

```bash
@obs-unified:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

GitHub Packages requires authentication for installing public packages. Use a
classic personal access token with `read:packages` for local installs. GitHub
Actions can use `GITHUB_TOKEN` when the workflow repository has package access.

Exception: `@obsunified/mcp-server` publishes to the public npm registry so
agents can install it without GitHub Packages authentication:

```bash
pnpm add -g @obsunified/mcp-server
```

Install examples:

```bash
pnpm add @obs-unified/telemetry-sdk
pnpm add @obs-unified/analytics-sdk
pnpm add @obs-unified/collector
pnpm add @obs-unified/dashboard
```

Go and Rust do not publish through GitHub Packages. GitHub Packages currently
supports npm, RubyGems, Apache Maven, Gradle, NuGet, Docker, and OCI/container
images. The Go SDK is consumed from the public Git module path:

```bash
go get github.com/obs-unified/obs-unified/sdks/go@latest
```

For Rust, use the Git dependency until a crates.io release is cut:

```toml
[dependencies]
obs-unified = { git = "https://github.com/obs-unified/obs-unified", package = "obs-unified" }
```
