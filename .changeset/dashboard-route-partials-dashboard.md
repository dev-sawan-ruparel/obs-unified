---
"@obsunified/dashboard": patch
---

Route deep links now select their target: `#/evaluations/:id` selects that eval case (falling back to the case saved from the same source entity), `#/service-map?service=` focuses the map on that service with a "Showing <service> · clear" chip, and `#/ai/calls/:id` fetches the call by id when it is outside the loaded span window. Hash parse/serialize helpers moved to `routes.ts` with tests, and eval source-type labels replace every underscore.
