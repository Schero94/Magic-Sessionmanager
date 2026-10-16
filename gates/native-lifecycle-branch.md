# Gates: Native lifecycle branch integration

Scope: Adapter, auth hooks, native JWT validity and Magic sidecar operations compose correctly.

- [x] L1: Adapter and auth leaves pass their gates with parent-rerun evidence.
  CHECK: node /Users/schero/.agents/skills/unlazy/scripts/gate-check.mjs --status gates/native-adapter.md && node /Users/schero/.agents/skills/unlazy/scripts/gate-check.mjs --status gates/native-auth.md
  EXPECT: UNMET: 0
  EVIDENCE: Parent reran `gate-check --status` for `native-adapter.md` and `native-auth.md`; results were ALL MET (5/5 and 7/7).

- [x] L2: Native revoke blocks a current unexpired access token, while legacy behavior remains unchanged.
  CHECK: node --test tests/native-session-manager.test.js tests/session-aware-jwt.test.js tests/auth-interceptors.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 73.708542

- [x] L3: No native access/refresh token is issued, rotated, or revoked twice by Magic middleware.
  EVIDENCE: `auth-interceptors.test.js` and `refresh-token.test.js` assert that Strapi owns native issuance/rotation, password-change links only the resulting session, refresh updates the sidecar once, compensation revokes only the failed child, and successful Users & Permissions logout is not revoked a second time. Live refresh and both logout routes passed on the isolated host.
