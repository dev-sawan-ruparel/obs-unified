# UI Review Playbook

Use this checklist when reviewing dashboard UI changes that depend on collector
data, auth, or proxy behavior.

## Evidence Dashboard Review

1. Start the local collector with `pnpm --filter @obs-demo/collector run dev`.
2. Start the web app with `pnpm --filter @obs-demo/web dev --host 127.0.0.1`.
3. Verify login through the web proxy using the password in
   `apps/collector/.dev.vars`.
4. Review the empty state first, then seed local-only telemetry that exercises
   populated tables, ranked lists, long source names, and narrow viewports.
5. Capture screenshots at desktop, tablet, and mobile widths.
6. Check auth/proxy evidence in collector logs: `/auth/login`,
   `/internal/projects`, and the feature endpoint should return `200`.
7. Review visuals for scanability, truncation, table overflow, disabled states,
   mobile header fit, and whether the first viewport communicates the workflow.
8. Include loaded-bundle, dark-mode, and command-palette checks when the change
   touches layout or shared shell controls.

For the Evidence Retrieval dashboard, save screenshots under
`artifacts/evidence-ui-review/` and use local sample rows with ids prefixed by
`visual_` so they can be cleaned up without touching real telemetry.
