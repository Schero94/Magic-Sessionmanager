# Gates: Native end-user session integration

Scope: Approved backward-compatible integration of Magic Sessionmanager with Strapi's native Users & Permissions session manager.

- [x] N1: All native lifecycle, Magic compatibility, and product acceptance branch gates are met.
  CHECK: node /Users/schero/.agents/skills/unlazy/scripts/gate-check.mjs --status gates/native-lifecycle-branch.md && node /Users/schero/.agents/skills/unlazy/scripts/gate-check.mjs --status gates/native-compatibility-branch.md && node /Users/schero/.agents/skills/unlazy/scripts/gate-check.mjs --status gates/native-acceptance-branch.md
  EXPECT: UNMET: 0
  EVIDENCE: Parent reran all three branches on 2026-10-15. Native lifecycle: ALL MET (3), Magic compatibility: ALL MET (3), product acceptance: ALL MET (3).

- [x] N2: All Magic route paths, methods, auth requirements, permissions, and response envelopes remain unchanged.
  CHECK: node --test tests/route-contracts.test.js tests/native-session-routes.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 57.623041

- [x] N3: Native refresh mode uses Strapi as token/session authority; legacy mode retains the existing plugin-owned lifecycle.
  EVIDENCE: Adapter and auth unit tests cover both modes. The isolated Strapi 5.58.0 host confirmed refresh child rotation, native session listing/revocation, Magic metadata correlation and legacy Magic route compatibility without double token operations.

- [x] N4: No unrelated user changes were lost, overwritten, staged, or committed; no changes were pushed or published.
  EVIDENCE: Root and plugin user-owned changes were preserved. No files were staged or committed, and no push, publish, release, or external provider operation was performed.
