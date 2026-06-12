# Package Registry

obs-unified's public JavaScript packages publish to the public npm registry.
New installs should not require GitHub Packages configuration:

```bash
pnpm add @obsunified/telemetry-sdk
pnpm add @obsunified/analytics-sdk
pnpm dlx @obsunified/cli doctor http://localhost:8790 --origin http://localhost:5173
pnpm add -g @obsunified/mcp-server
```

The repository used GitHub Packages in earlier releases. If an old environment
has this scope override, remove it before installing current packages:

```bash
pnpm config delete @obs-unified:registry
```

During the transition, the already-published GitHub Packages versions may still
require a GitHub token. The next release from this repo is configured to publish
the `@obsunified/*` packages to npmjs.

Go and Rust do not use npm:

```bash
go get github.com/obs-unified/obs-unified/sdks/go@latest
```

```bash
cargo add obs-unified
```

Go availability is controlled by public Git tags in the form `sdks/go/vX.Y.Z`.
Rust availability is controlled by the public crates.io package `obs-unified`.
