# External Access Layer Templates

This directory provides adaptable reference configuration templates for securing `obs-unified` deployments behind an external identity and access proxy. These files are adaptable templates rather than a turnkey local deployment; site-specific secret, domain name, and TLS/certificate provisioning are required before deployment.

## Files

- `nginx.conf`: Adaptable Nginx `conf.d` server fragment template implementing `auth_request` via `oauth2-proxy`, `X-Project-Id` forwarding for multi-project selection, `/auth/*` routing to the collector, and `/v1/*` ingest pass-through. Requires TLS certificate provisioning and upstream host configuration.
- `caddy.Caddyfile`: Adaptable Caddy template using `forward_auth` to protect dashboard and query APIs while letting `/v1/*` pass directly to the collector. Requires domain name and upstream host configuration.
- `oauth2-proxy.env.example`: Environment configuration template for `oauth2-proxy` with OIDC provider settings, secure session cookies, domain restrictions, and `skip_auth_routes` for OTLP ingest. Requires generating random cookie secrets and provisioning IdP client credentials.
- `cloudflared-config.yml`: Adaptable Cloudflare Tunnel (`cloudflared`) template separating public ingest (`ingest.example.com`) from Cloudflare Access-gated dashboard traffic (`obs.example.com`), with `/health` mapped on both hostnames. Requires tunnel UUID, credential file setup, and ingress hostname configuration.

## Key Design Constraints

1. **Native RBAC & SSO are absent**: `obs-unified` does not have user accounts or role permissions. The external access layer is responsible for authenticating users and granting access.
2. **Ingest route separation**: `/v1/*` routes MUST bypass SSO so that instrumented backend applications and client SDKs can submit telemetry directly using their project API keys.
3. **Health route separation**: `/health` must remain public for external uptime probes and clock offset checks. In Cloudflare setups, it is mapped on both `ingest.example.com` and `obs.example.com` (using an Access Bypass policy on the dashboard domain).
4. **Auth route ownership**: `/auth/*` routes are owned by the collector (not the dashboard static server) and handle `POST /auth/login`, `GET /auth/check`, and `POST /auth/logout`.
5. **Project scoping vs RBAC**: `X-Project-Id` must be passed by reverse proxies to allow dashboard project selection and MCP project scoping. Note that this is tenant data scoping, not per-user authorization: any authenticated dashboard user can query any project in the database.
6. **Investigation MCP constraints**: When `dashboardAuth` is enabled on the collector, `/internal/*` strictly checks the `obs_session` cookie; ingest keys or arbitrary bearer tokens are not accepted for reading internal data. Furthermore, `@obsunified/mcp-server` does not emit Cloudflare Access service token headers (`CF-Access-Client-*`). Run the MCP server within the trusted internal network / VPC directly against the collector port using `OBS_SESSION_COOKIE`.
