# @obsunified/mcp-server

## 2.0.2

### Patch Changes

- 82c6d9d: Implement programmatic DASHBOARD_TOKEN / OBS_DASHBOARD_TOKEN Bearer authentication contract on collector /internal/\* routes and enforce strict rejection of ingest keys on read and admin endpoints.

## 2.0.1

### Patch Changes

- eec7b07: Productize production-to-eval per-case action tree comparisons in the
  Evaluations dashboard and publish the MCP server through npmjs for no-auth
  agent installs.

## 2.0.0

### Major Changes

- e9e2cab: Add the first obs-unified MCP server, exposing collector investigation endpoints as local MCP tools for AI agents.
