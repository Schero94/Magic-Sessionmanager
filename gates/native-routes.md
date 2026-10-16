# Gates: Magic API compatibility

Scope: Existing Magic routes, response envelopes, permission checks and owner checks remain intact while delegating native operations.

- [x] R1: Existing admin/content-api route paths, methods, policies and envelopes are unchanged.
  CHECK: node --test tests/route-contracts.test.js tests/native-session-routes.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 52.683083

- [x] R2: Own-session listing/revocation never accesses another end-user's native session.
  CHECK: node --test tests/native-session-routes.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 52.716334

- [x] R3: Logout-all and logout-others revoke the intended native sessions and preserve the current session when requested.
  CHECK: node --test tests/native-session-routes.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 51.807

- [x] R4: Admin terminate, clean and delete routes retain permission gates and revoke native state before destructive sidecar changes.
  CHECK: node --test tests/session-controller-delete.test.js tests/native-session-routes.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 60.221125

- [x] R5: No new public route or weakened authentication/rate limit is introduced.
  CHECK: node --test tests/route-contracts.test.js tests/native-session-routes.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 60.817667
