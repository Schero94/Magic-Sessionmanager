# Gates: Local Strapi and browser acceptance

Scope: The built plugin runs in isolated Strapi 5.58.0 and native end-user lifecycle is verified without touching admin or real-user sessions.

- [x] E1: Test host database path and running process are confirmed isolated before creating disposable user data.
  EVIDENCE: Before API mutations, PID 71098 had `DATABASE_FILENAME=.tmp/native-session-fresh.FzAudR/data.db`; listener PID 70160 was bound to `127.0.0.1:1337`, and `lsof` confirmed the exact SQLite file. A read-only preflight showed 2 Users & Permissions roles, 13 native permission rows, 0 Magic permission rows and 0 test users/sessions. All API-created accounts and revokes stayed in this isolated database. The earlier `native-session-int.Q028Qt` database was never opened by the app process; later read-only counts found 1 U&P user, 2 Magic session rows and 2 Strapi session rows. The unrelated default DB incident remains documented in PLAN.md.

- [x] E2: Plugin build, full unit tests, type checks, verify and runtime bundle all pass.
  CHECK: npm test && npm run test:ts:back && npm run test:ts:front && npm run verify && npm run verify:runtime && npm run build
  EXPECT: # fail 0
  EVIDENCE: 2026-10-15 final re-verification: 273 tests passed, 0 failed; frontend and backend TypeScript passed; package verify, runtime bundle check and plugin build passed. `node scripts/plugins.mjs Magic-Sessionmanager quality` reported `ALL PLUGIN QUALITY GATES PASSED`.

- [x] E3: Shared Strapi app builds and boots with every configured plugin key on the isolated test database.
  CHECK: npm --prefix ../../test-app run build
  EXPECT: build
  EVIDENCE: The isolated host boot reported all eight configured plugin keys. The 2026-10-15 final admin build completed successfully. Host PID 27673 remained bound to 127.0.0.1:1337 with `DATABASE_FILENAME=.tmp/native-session-fresh.FzAudR/data.db`; the browser follow-up used synthetic records only.

- [x] E4: Native and Magic list/revoke/logout/refresh behavior agrees for a disposable end-user session.
  EVIDENCE: On the isolated FzAudR DB, registration, native session list, Magic `my-sessions`, current-session, refresh and both logout endpoints returned the expected 200 responses. Magic current-session flags matched the Strapi-issued child session after refresh rotation. Wrong-owner access returned 403; deleting the current session returned 400; Magic single-session revoke and native `DELETE /api/auth/sessions/:sessionId` returned 200 and the revoked token was denied. Logout-others kept the caller active and revoked the other device. Logout-all revoked the current token. Magic logout and native Users & Permissions logout both revoked their native session. After native-side revocation, Magic history showed the row inactive and `meta.active` was 1.

- [x] E5: Playwright CLI verifies Magic session UI at desktop and mobile widths with no unexpected console/API errors.
  EVIDENCE: 2026-10-15 final Playwright pass on the isolated host opened the dashboard, details modal, settings, analytics, activation page and Users & Permissions user editor. At 390x844 and 1440x1000 the document width matched the viewport and measured visible overflow was zero. With 22 synthetic sessions and page size 10, ranges were 1-10, 11-20 and 21-22; previous/next disabled at the boundaries. Search from page two reset to page one, and clearing filters restored the full list. The detail modal opened at 390px with a 366px width, zero overflow and no leaked `tag` attributes; Show/Hide Details, Escape and Close worked. Safe local settings controls were reverted with Reset; no settings were saved. Plugin pages had 0 errors and 2 Strapi-level warnings (React Router future flag and `useRBAC` deprecation). The U&P editor requested Strapi core i18n/preview endpoints that return 404 in this host; those are not Session Manager routes. Both export buttons were clicked with Blob interception: CSV returned 22 rows and JSON returned 22 sessions with no token fields. The interceptor was restored and no file was saved. No credentials, provider requests or destructive actions were triggered in this follow-up. Historical baseline: an earlier CLI click confirmed one session termination for a synthetic end-user in the isolated FzAudR database. No pre-existing end-user or Strapi Admin session was touched.

- [x] E6: Anonymous, wrong-owner end-user and unauthorized-admin access are denied without session data leakage.
  EVIDENCE: On the isolated FzAudR DB, anonymous `GET /api/magic-sessionmanager/my-sessions` returned 403, a different authenticated U&P user requesting another user's sessions returned 403, and unauthenticated `GET /magic-sessionmanager/sessions` returned 401. No session rows or response bodies were exposed in the recorded evidence.

- [x] E7: Existing admin test session and all pre-existing end-user sessions remain untouched; no provider-side effects run.
  EVIDENCE: All registrations and revocations ran only against `.tmp/native-session-fresh.FzAudR/data.db` with generated `example.invalid` test accounts. The pre-existing `native-session-int.Q028Qt` DB was never used by the app process; its session aggregates were read-only. No email, webhook, GeoIP lookup, provider call, or session action ran against pre-existing data.
