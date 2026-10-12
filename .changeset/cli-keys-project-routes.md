---
"@obsunified/cli": patch
---

Fix `keys` and `doctor` to call the routes the collector actually serves.

- `keys mint` now `POST`s `/internal/projects/<id>/keys` with a JSON `{ name }`
  body (was `POST /internal/keys/mint`, which does not exist) and prints the
  returned plaintext key, id, and one-time warning. `--name <label>` sets the
  key label (default `cli`); `--json` prints the raw response.
- `keys list` now `GET`s `/internal/projects/<id>/keys` (was `GET /internal/keys`)
  and prints id, name, key prefix, creation time, and active/revoked status.
- Project selection: `--project <id>`, then `OBS_PROJECT_ID`, then discovery via
  `GET /internal/projects` (the collector's `default` project, or its only
  project). With several non-default projects the CLI lists them and asks for
  `--project` instead of guessing.
- Errors now distinguish a rejected `OBS_ADMIN_TOKEN` (HTTP 401/403) from an
  unknown project (`Project not found`) and from an unknown route (HTTP 404 on
  a non-collector URL or an older collector).
- `doctor`'s dashboard read-API check probes `GET /internal/projects` instead of
  the nonexistent `/internal/spans`. If `OBS_ADMIN_TOKEN` is set it is sent and
  must be accepted. Without it a 401 is healthy, and a 200 is now a failed
  check: the collector is exposing its internal API unauthenticated.

Authorization is unchanged: `Authorization: Bearer $OBS_ADMIN_TOKEN`, where
`OBS_ADMIN_TOKEN` must match the collector's `DASHBOARD_TOKEN`.
