---
"@obsunified/mcp-server": minor
---

Add `list_incidents`, `get_incident` and `get_remediation_proposal` (always registered) and the opt-in `open_incident` write tool (26 read + 4 write tools). `record_investigation_finding` validates counterfactual eval runs before persisting, returns `data.finding` plus `data.counterfactualError` when verification fails after the insert, and accepts an optional `idempotencyKey`; its `fingerprintInput` fields are now optional. `propose_remediation_action` accepts optional `webhookUrl` and `webhookSecret` for grant handoff.
