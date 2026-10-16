# Gates: Native auth lifecycle

Scope: Login, password-change token replacement, refresh, logout and JWT enforcement respect Strapi's native session lifecycle.

- [x] H1: Legacy login/refresh/logout regression tests remain green.
  CHECK: node --test tests/auth-interceptors.test.js tests/refresh-token.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 101.024667

- [x] H2: Native login creates a linked metadata sidecar without storing raw native tokens.
  CHECK: node --test tests/auth-interceptors.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 76.5315

- [x] H3: Native refresh/password-change hooks do not issue or rotate a second token family.
  CHECK: node --test tests/auth-interceptors.test.js tests/refresh-token.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 86.669375

- [x] H4: Current native access tokens are rejected when `isSessionActive` reports their native session revoked.
  CHECK: node --test tests/session-aware-jwt.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 55.29875

- [x] H5: Plugin strict, block, inactivity, max-age and last-seen behavior remains additive for linked sidecars.
  CHECK: node --test tests/session-aware-jwt.test.js tests/last-seen.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 51.255666

- [x] H6: Native post-rotation sidecar failure strips issued tokens and attempts safe native compensation.
  CHECK: node --test tests/auth-interceptors.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 75.929167

- [x] H7: On a fresh Strapi database, Magic's permission setup retries after the Users & Permissions authenticated role is created, before the first protected Magic Content API route; authentication and owner checks remain required.
  CHECK: node --test tests/content-api-permissions.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 51.264709
