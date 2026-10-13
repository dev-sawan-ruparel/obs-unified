---
"@obsunified/mcp-server": minor
---

Publish the RFC 0011 evidence retrieval tools. The server now exposes
`get_evidence_bundle`, `retrieve_evidence_ref`, `search_evidence_ref`, and
`get_evidence_stats` alongside the existing investigation tools (20 tools in
total). These shipped on `main` after 2.0.1 but were never published, so the
documented evidence-bundle workflow did not work against the npm package.

Also raises the `@modelcontextprotocol/sdk` floor to 1.32.1, which pulls the
patched `express`, `proxy-addr`, `fast-uri`, and `ip-address` versions flagged
by `pnpm audit`.
