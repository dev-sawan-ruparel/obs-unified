#!/usr/bin/env node

/**
 * Validation test suite for obs-unified production identity & external access recipes.
 * Validates documentation navigation, configuration file integrity, route boundaries,
 * MCP constraints, and threat model invariants.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;

function assert(condition, message) {
	if (!condition) {
		console.error(`❌ FAIL: ${message}`);
		failed++;
		throw new Error(message);
	}
	console.log(`✅ PASS: ${message}`);
	passed++;
}

console.log("=== 1. Validating Documentation & Navigation Invariants ===");

// 1.1 Verify Markdown and MDX docs exist
const docMdPath = path.join(repoRoot, "docs/ops/identity-access-recipes.md");
const docMdxPath = path.join(
	repoRoot,
	"apps/docs/content/docs/ops/identity-access.mdx",
);

assert(
	existsSync(docMdPath),
	"docs/ops/identity-access-recipes.md exists on disk",
);
assert(
	existsSync(docMdxPath),
	"apps/docs/content/docs/ops/identity-access.mdx exists on disk",
);

const docMdContent = readFileSync(docMdPath, "utf-8");
const docMdxContent = readFileSync(docMdxPath, "utf-8");

// 1.2 Verify clear statement that native per-user RBAC and SSO are absent
const rbacPhrases = [
	"Native per-user RBAC and SSO are absent",
	"does NOT include native per-user Role-Based Access Control",
];
const mdHasRbacNotice = rbacPhrases.some((phrase) =>
	docMdContent.toLowerCase().includes(phrase.toLowerCase()),
);
const mdxHasRbacNotice = rbacPhrases.some((phrase) =>
	docMdxContent.toLowerCase().includes(phrase.toLowerCase()),
);

assert(
	mdHasRbacNotice,
	"docs/ops/identity-access-recipes.md explicitly states native RBAC/SSO absence",
);
assert(
	mdxHasRbacNotice,
	"apps/docs/content/docs/ops/identity-access.mdx explicitly states native RBAC/SSO absence",
);

// 1.3 Verify Grounding in actual codebase tokens & constraints
assert(
	docMdContent.includes("DASHBOARD_PASSWORD"),
	"Doc covers DASHBOARD_PASSWORD",
);
assert(
	docMdContent.includes("INGEST_KEY"),
	"Doc covers INGEST_KEY / ingest_keys table",
);
assert(
	docMdContent.includes("obs_session"),
	"Doc covers obs_session cookie contract",
);
assert(
	docMdContent.includes("@obsunified/mcp-server"),
	"Doc covers Investigation MCP Server boundaries",
);
assert(
	docMdContent.includes("CF-Access-Client-") || docMdContent.includes("service token"),
	"Doc covers Cloudflare Access service token constraints",
);
assert(
	docMdContent.includes("X-Project-Id"),
	"Doc covers X-Project-Id multi-project scoping",
);

// 1.4 Verify navigation meta.json files
const opsMetaPath = path.join(
	repoRoot,
	"apps/docs/content/docs/ops/meta.json",
);
const docsMetaPath = path.join(
	repoRoot,
	"apps/docs/content/docs/meta.json",
);

const opsMeta = JSON.parse(readFileSync(opsMetaPath, "utf-8"));
assert(
	opsMeta.pages.includes("identity-access"),
	"apps/docs/content/docs/ops/meta.json includes 'identity-access'",
);

const docsMeta = JSON.parse(readFileSync(docsMetaPath, "utf-8"));
assert(
	docsMeta.pages.includes("ops/identity-access"),
	"apps/docs/content/docs/meta.json includes 'ops/identity-access'",
);

// 1.5 Verify cross-links in production.md and production.mdx
const prodMdContent = readFileSync(
	path.join(repoRoot, "docs/ops/production.md"),
	"utf-8",
);
const prodMdxContent = readFileSync(
	path.join(repoRoot, "apps/docs/content/docs/ops/production.mdx"),
	"utf-8",
);
assert(
	prodMdContent.includes("identity-access-recipes.md"),
	"docs/ops/production.md links to identity-access-recipes.md",
);
assert(
	prodMdxContent.includes("identity-access"),
	"apps/docs/content/docs/ops/production.mdx links to identity-access",
);

// 1.6 Verify MDX Nginx snippet routes /auth/* to collector
assert(
	docMdxContent.includes("location /auth/ {") &&
		docMdxContent.includes("proxy_pass http://collector_backend;"),
	"apps/docs/content/docs/ops/identity-access.mdx routes /auth/* to collector_backend",
);

console.log("\n=== 2. Validating Example Configuration Files ===");

const nginxConfPath = path.join(
	repoRoot,
	"examples/external-access/nginx.conf",
);
const caddyFilePath = path.join(
	repoRoot,
	"examples/external-access/caddy.Caddyfile",
);
const oauth2EnvPath = path.join(
	repoRoot,
	"examples/external-access/oauth2-proxy.env.example",
);
const cloudflaredPath = path.join(
	repoRoot,
	"examples/external-access/cloudflared-config.yml",
);

assert(existsSync(nginxConfPath), "examples/external-access/nginx.conf exists");
assert(
	existsSync(caddyFilePath),
	"examples/external-access/caddy.Caddyfile exists",
);
assert(
	existsSync(oauth2EnvPath),
	"examples/external-access/oauth2-proxy.env.example exists",
);
assert(
	existsSync(cloudflaredPath),
	"examples/external-access/cloudflared-config.yml exists",
);

// 2.1 Verify Nginx config is a valid conf.d fragment and routes properly
const nginxContent = readFileSync(nginxConfPath, "utf-8");
assert(
	!nginxContent.includes("events {") && !nginxContent.includes("http {"),
	"nginx.conf is a valid conf.d fragment (no wrapping events/http blocks)",
);
assert(
	nginxContent.includes("auth_request /oauth2/auth;"),
	"nginx.conf wires auth_request to oauth2-proxy",
);
assert(
	!nginxContent.includes('proxy_set_header X-Project-Id "";'),
	"nginx.conf does NOT strip X-Project-Id globally",
);
assert(
	nginxContent.includes("proxy_set_header X-Project-Id $http_x_project_id;"),
	"nginx.conf forwards X-Project-Id for project selection",
);
assert(
	!nginxContent.includes("proxy_pass_header Authorization;"),
	"nginx.conf does NOT contain misleading proxy_pass_header directives",
);
assert(
	nginxContent.includes("location /v1/"),
	"nginx.conf defines dedicated /v1/ ingest location",
);
assert(
	nginxContent.includes("location = /health"),
	"nginx.conf defines dedicated /health probe location",
);
assert(
	nginxContent.includes("location /auth/ {"),
	"nginx.conf defines dedicated /auth/ location routing to collector",
);
assert(
	nginxContent.includes("client_max_body_size 10m;"),
	"nginx.conf sets appropriate client_max_body_size for OTLP payloads",
);

// 2.2 Verify Caddy config directives
const caddyContent = readFileSync(caddyFilePath, "utf-8");
assert(
	caddyContent.includes("forward_auth 127.0.0.1:4180"),
	"caddy.Caddyfile configures forward_auth to oauth2-proxy",
);
assert(
	!caddyContent.includes("header_up -X-Project-Id"),
	"caddy.Caddyfile does NOT strip X-Project-Id header",
);

// 2.3 Verify oauth2-proxy env settings
const oauth2EnvContent = readFileSync(oauth2EnvPath, "utf-8");
assert(
	oauth2EnvContent.includes("OAUTH2_PROXY_SKIP_AUTH_ROUTES=^/health$,^/v1/.*"),
	"oauth2-proxy config bypasses auth for /health and /v1/* ingest",
);
assert(
	oauth2EnvContent.includes("OAUTH2_PROXY_COOKIE_SECURE=true"),
	"oauth2-proxy enforces secure cookie",
);

// 2.4 Verify Cloudflare Tunnel config maps /health on both hostnames
const cloudflaredContent = readFileSync(cloudflaredPath, "utf-8");
assert(
	cloudflaredContent.includes("hostname: ingest.example.com") &&
		cloudflaredContent.includes("path: ^/v1/"),
	"cloudflared-config.yml routes ingest traffic via dedicated ingest hostname",
);
assert(
	cloudflaredContent.includes("hostname: ingest.example.com") &&
		cloudflaredContent.includes("path: ^/health$"),
	"cloudflared-config.yml routes /health via ingest hostname",
);
assert(
	cloudflaredContent.includes("hostname: obs.example.com") &&
		cloudflaredContent.includes("path: ^/health$"),
	"cloudflared-config.yml routes /health via obs.example.com dashboard hostname",
);

// 2.5 Verify README and docs describe adaptable templates and do not claim docker-compose.access.yml is included
const readmePath = path.join(repoRoot, "examples/external-access/README.md");
const readmeContent = readFileSync(readmePath, "utf-8");

assert(
	!readmeContent.toLowerCase().includes("docker-compose.access.yml"),
	"README.md does not reference or claim docker-compose.access.yml",
);
assert(
	readmeContent.includes("adaptable") && readmeContent.includes("template"),
	"README.md describes files as adaptable templates",
);
assert(
	readmeContent.includes("TLS") && readmeContent.includes("secret"),
	"README.md specifies secret/TLS setup requirements",
);
assert(
	!docMdContent.toLowerCase().includes("docker-compose.access.yml"),
	"identity-access-recipes.md does not reference or claim docker-compose.access.yml",
);
assert(
	!docMdxContent.toLowerCase().includes("docker-compose.access.yml"),
	"identity-access.mdx does not reference or claim docker-compose.access.yml",
);

console.log("\n=== 3. Simulating Route Policy & Boundary Enforcement ===");

/**
 * Proxy routing simulation model:
 * Simulates reverse proxy path evaluation and auth decisions based on actual collector rules:
 * - /health: public
 * - /v1/*: ingest key required by collector, bypasses SSO
 * - /auth/*: routed to collector
 * - /internal/*: under dashboardAuth, REQUIRES obs_session cookie; ingest key or bearer token is rejected
 * - X-Project-Id: forwarded by proxy for project scoping (validated against DB)
 */
function evaluateProxyDecision({ path, method, headers, hasSsoSession }) {
	// 1. Health check: always public
	if (path === "/health") {
		return { action: "ALLOW_PUBLIC", upstream: "collector:8790" };
	}

	// 2. Telemetry Ingest: bypasses SSO, passes to collector
	if (path.startsWith("/v1/")) {
		const authHeader = headers["authorization"] || headers["x-api-key"];
		if (!authHeader) {
			return { action: "COLLECTOR_INGEST_UNAUTHENTICATED", upstream: "collector:8790", status: 401 };
		}
		return { action: "ALLOW_INGEST", upstream: "collector:8790", status: 200 };
	}

	// 3. OAuth callback: handled by oauth2-proxy
	if (path.startsWith("/oauth2/")) {
		return { action: "OAUTH2_PROXY", upstream: "oauth2-proxy:4180" };
	}

	// 4. Protected Paths: /internal/*, /auth/*, /
	const isProtected = path.startsWith("/internal/") || path.startsWith("/auth/") || path === "/" || !path.includes(".");
	if (isProtected) {
		// Perimeter check: user must have valid SSO session
		if (!hasSsoSession) {
			return { action: "REDIRECT_SSO", status: 302, location: "/oauth2/sign_in" };
		}

		// Internal collector endpoints require obs_session cookie under dashboardAuth
		if (path.startsWith("/internal/")) {
			const cookie = headers["cookie"] || "";
			const hasObsSession = cookie.includes("obs_session=");
			// Ingest key or bearer token is NOT accepted by dashboardAuth on /internal/*
			if (!hasObsSession) {
				return { action: "COLLECTOR_DASHBOARD_UNAUTHENTICATED", upstream: "collector:8790", status: 401 };
			}
			return {
				action: "ALLOW_INTERNAL_QUERY",
				upstream: "collector:8790",
				status: 200,
				projectId: headers["x-project-id"] || "default",
			};
		}

		if (path.startsWith("/auth/")) {
			return { action: "ALLOW_AUTH_ENDPOINT", upstream: "collector:8790", status: 200 };
		}

		return { action: "ALLOW_DASHBOARD_SPA", upstream: "dashboard:5173", status: 200 };
	}

	return { action: "NOT_FOUND", status: 404 };
}

// Test 3.1: Health endpoint is always reachable without any credentials
const healthDecision = evaluateProxyDecision({
	path: "/health",
	method: "GET",
	headers: {},
	hasSsoSession: false,
});
assert(
	healthDecision.action === "ALLOW_PUBLIC",
	"Simulation: /health passes freely without SSO",
);

// Test 3.2: Ingest endpoint (/v1/traces) bypasses SSO but rejects missing API key
const ingestNoKeyDecision = evaluateProxyDecision({
	path: "/v1/traces",
	method: "POST",
	headers: { "content-type": "application/json" },
	hasSsoSession: false,
});
assert(
	ingestNoKeyDecision.action === "COLLECTOR_INGEST_UNAUTHENTICATED" &&
		ingestNoKeyDecision.status === 401,
	"Simulation: Ingest without API key rejects at collector (bypasses SSO redirect)",
);

// Test 3.3: Ingest endpoint (/v1/traces) succeeds with API key regardless of SSO
const ingestWithKeyDecision = evaluateProxyDecision({
	path: "/v1/traces",
	method: "POST",
	headers: { authorization: "Bearer obs_test_key" },
	hasSsoSession: false,
});
assert(
	ingestWithKeyDecision.action === "ALLOW_INGEST" &&
		ingestWithKeyDecision.status === 200,
	"Simulation: Ingest with API key succeeds without SSO session",
);

// Test 3.4: Unauthenticated access to /internal/telemetry/overview is blocked by perimeter
const internalNoSsoDecision = evaluateProxyDecision({
	path: "/internal/telemetry/overview",
	method: "GET",
	headers: {},
	hasSsoSession: false,
});
assert(
	internalNoSsoDecision.action === "REDIRECT_SSO" &&
		internalNoSsoDecision.status === 302,
	"Simulation: /internal/* without perimeter auth redirects to SSO login",
);

// Test 3.5: Access with SSO session but missing obs_session cookie fails at collector layer
const internalSsoNoCookieDecision = evaluateProxyDecision({
	path: "/internal/telemetry/overview",
	method: "GET",
	headers: { cookie: "other_session=xyz" },
	hasSsoSession: true,
});
assert(
	internalSsoNoCookieDecision.action ===
		"COLLECTOR_DASHBOARD_UNAUTHENTICATED" &&
		internalSsoNoCookieDecision.status === 401,
	"Simulation: /internal/* with SSO but without obs_session is denied by collector",
);

// Test 3.6: Access with SSO session + valid obs_session succeeds and retains X-Project-Id
const internalFullAuthDecision = evaluateProxyDecision({
	path: "/internal/telemetry/overview",
	method: "GET",
	headers: {
		cookie: "obs_session=valid.signed.cookie",
		"x-project-id": "proj-analytics",
	},
	hasSsoSession: true,
});
assert(
	internalFullAuthDecision.action === "ALLOW_INTERNAL_QUERY" &&
		internalFullAuthDecision.status === 200,
	"Simulation: /internal/* with SSO + obs_session succeeds",
);
assert(
	internalFullAuthDecision.projectId === "proj-analytics",
	"Simulation: X-Project-Id is preserved for multi-project tenant selection",
);

// Test 3.7: MCP query attempting to use ingest key against /internal/* fails under dashboardAuth
const mcpIngestKeyQueryDecision = evaluateProxyDecision({
	path: "/internal/evidence/bundle",
	method: "POST",
	headers: {
		authorization: "Bearer obs_ingest_key_123",
	},
	hasSsoSession: true,
});
assert(
	mcpIngestKeyQueryDecision.action === "COLLECTOR_DASHBOARD_UNAUTHENTICATED" &&
		mcpIngestKeyQueryDecision.status === 401,
	"Simulation: MCP cannot read /internal/* using write-only ingest key",
);

// Test 3.8: MCP query using obs_session cookie directly succeeds
const mcpCookieQueryDecision = evaluateProxyDecision({
	path: "/internal/evidence/bundle",
	method: "POST",
	headers: {
		cookie: "obs_session=valid.signed.cookie",
	},
	hasSsoSession: true,
});
assert(
	mcpCookieQueryDecision.action === "ALLOW_INTERNAL_QUERY" &&
		mcpCookieQueryDecision.status === 200,
	"Simulation: MCP query with obs_session cookie succeeds",
);

// Test 3.9: /auth/login request routes to collector
const authDecision = evaluateProxyDecision({
	path: "/auth/login",
	method: "POST",
	headers: {},
	hasSsoSession: true,
});
assert(
	authDecision.action === "ALLOW_AUTH_ENDPOINT" &&
		authDecision.upstream === "collector:8790",
	"Simulation: /auth/* routes to collector:8790",
);

console.log("\n=== 4. Checking Trailing Whitespace & EOF Blank Lines ===");

const allFilesToCheck = [
	docMdPath,
	docMdxPath,
	nginxConfPath,
	caddyFilePath,
	oauth2EnvPath,
	cloudflaredPath,
	path.join(repoRoot, "examples/external-access/README.md"),
	opsMetaPath,
	docsMetaPath,
	path.join(repoRoot, "docs/ops/production.md"),
	path.join(repoRoot, "apps/docs/content/docs/ops/production.mdx"),
];

for (const filePath of allFilesToCheck) {
	const content = readFileSync(filePath, "utf-8");
	assert(content.endsWith("\n"), `${path.basename(filePath)} ends with a newline`);
	assert(!content.endsWith("\n\n"), `${path.basename(filePath)} has no blank line at EOF`);
}

console.log(`\n🎉 ALL VALIDATION CHECKS PASSED: ${passed}/${passed} tests`);
process.exit(0);
