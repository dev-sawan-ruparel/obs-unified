---
"@obsunified/cli": patch
---

`obs-unified create --help` and `changes --help` print usage and exit 0. `create` now falls back to `OBS_INGEST_KEY`, prompts for the ingest key in a TTY without `--yes`, and reports the key source in its next steps.
