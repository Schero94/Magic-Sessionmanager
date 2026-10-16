# Gates: Magic compatibility branch integration

Scope: Native session service actions remain reachable through the established protected Magic API.

- [x] C1: Service and route leaves pass their gates with parent-rerun evidence.
  CHECK: node /Users/schero/.agents/skills/unlazy/scripts/gate-check.mjs --status gates/native-service.md && node /Users/schero/.agents/skills/unlazy/scripts/gate-check.mjs --status gates/native-routes.md
  EXPECT: UNMET: 0
  EVIDENCE: Parent reran `gate-check --status` for `native-service.md` and `native-routes.md`; results were ALL MET (7/7 and 5/5).

- [x] C2: Route paths, HTTP methods, response envelopes, and policies match the pre-change contract.
  CHECK: node --test tests/route-contracts.test.js tests/native-session-routes.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 52.228584

- [x] C3: Native list/revocation failures do not silently return complete or successful Magic results.
  EVIDENCE: `native-session-service.test.js` covers enumeration caps/failures and native revoke failure without sidecar mutation; `native-session-routes.test.js` and route-contract tests preserve explicit denial/status behavior. Live native revoke updated Magic history and a revoked access token was denied.
