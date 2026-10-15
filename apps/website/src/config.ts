export const DOCS_URL = "https://docs.obsunified.com/docs";

export const GETTING_STARTED_URL = `${DOCS_URL}/getting-started`;

export const EXAMPLES_URL = `${DOCS_URL}/examples`;

export const SDK_DOCS_URL = `${DOCS_URL}/sdks`;

export const SDK_REFERENCE_URL = `${DOCS_URL}/sdk-reference`;

export const PRODUCTION_OPS_URL = `${DOCS_URL}/ops/production`;

export const INSTALLATION_URL = `${DOCS_URL}/installation`;

export const NPM_ORG_URL = "https://www.npmjs.com/org/obsunified";

export const GHCR_IMAGE = "ghcr.io/dev-sawan-ruparel/obs-unified";

export const CRATE_URL = "https://crates.io/crates/obs-unified";

export const GO_MODULE_URL = "https://pkg.go.dev/github.com/dev-sawan-ruparel/obs-unified/sdks/go";

export { GITHUB_REPO_LINK } from "../../../config/project";
import { GITHUB_REPO_LINK } from "../../../config/project";

export const GHCR_PACKAGE_URL = `${GITHUB_REPO_LINK}/pkgs/container/obs-unified`;

function npmPackageUrl(name: string): string {
  return `https://www.npmjs.com/package/${name}`;
}

export const FOOTER_PACKAGES = [
  {
    name: "ghcr.io/dev-sawan-ruparel/obs-unified",
    label: "Docker image",
    href: GHCR_PACKAGE_URL,
  },
  {
    name: "@obsunified/collector",
    label: "Collector",
    href: npmPackageUrl("@obsunified/collector"),
  },
  {
    name: "@obsunified/telemetry-sdk",
    label: "Server SDK",
    href: npmPackageUrl("@obsunified/telemetry-sdk"),
  },
  {
    name: "@obsunified/analytics-sdk",
    label: "Browser SDK",
    href: npmPackageUrl("@obsunified/analytics-sdk"),
  },
  {
    name: "@obsunified/dashboard",
    label: "Dashboard",
    href: npmPackageUrl("@obsunified/dashboard"),
  },
  {
    name: "@obsunified/mcp-server",
    label: "MCP server",
    href: npmPackageUrl("@obsunified/mcp-server"),
  },
  {
    name: "obs-unified (crates.io)",
    label: "Rust SDK",
    href: CRATE_URL,
  },
  {
    name: "sdks/go (pkg.go.dev)",
    label: "Go SDK",
    href: GO_MODULE_URL,
  },
] as const;
