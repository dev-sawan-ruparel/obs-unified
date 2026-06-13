---
"@obsunified/cli": patch
---

`doctor --origin` now replaces the default origin list instead of adding to it, and the default shrinks to `http://localhost:5173`. Previously the hardcoded `http://localhost:8080` default stayed in the checked set even when `--origin` was passed, so the documented verify command failed its browser-ingest CORS check (exit 1) against a perfectly healthy all-in-one container. Pass `--origin` repeatedly — or set `OBS_DOCTOR_ORIGINS` — to check several origins, e.g. `--origin http://localhost:8080` for the Astronomy Shop demo.
