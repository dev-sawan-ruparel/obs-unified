export const DOCS_URL = "https://docs.obsunified.com/docs";

export const SDK_DOCS_URL = `${DOCS_URL}/sdks`;

export const GITHUB_URL = "https://github.com/obs-unified/obs-unified";

export const FOOTER_PACKAGES = [
  {
    name: "@obs-unified/collector",
    label: "Collector",
    href: `${GITHUB_URL}/tree/main/packages/obs-collector`,
  },
  {
    name: "@obs-unified/telemetry-sdk",
    label: "Server SDK",
    href: `${GITHUB_URL}/tree/main/packages/telemetry-sdk`,
  },
  {
    name: "@obs-unified/analytics-sdk",
    label: "Browser SDK",
    href: `${GITHUB_URL}/tree/main/packages/analytics-sdk`,
  },
  {
    name: "@obs-unified/dashboard",
    label: "Dashboard",
    href: `${GITHUB_URL}/tree/main/packages/dashboard`,
  },
] as const;
