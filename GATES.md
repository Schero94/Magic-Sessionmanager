# Session Manager mobile, desktop, API and security gates

Scope: Continue the approved Strapi-native UI direction for Users & Permissions end-user sessions. Keep Strapi Admin sessions, unrelated plugins, live user data and external provider effects out of scope.

- [x] G1: Current-state, target-state, route inventory and click/API acceptance matrix are recorded for every Session Manager screen.
  CHECK: test -f docs/plans/2026-10-16-sessionmanager-functional-acceptance.md && rg -q "Current state" docs/plans/2026-10-16-sessionmanager-functional-acceptance.md && rg -q "Target state" docs/plans/2026-10-16-sessionmanager-functional-acceptance.md && echo FUNCTIONAL_SPEC_PRESENT
  EXPECT: FUNCTIONAL_SPEC_PRESENT
  EVIDENCE: `docs/plans/2026-10-16-sessionmanager-functional-acceptance.md` records the current pages, the unsaved-user and empty-blocklist defects found, all 20 admin and 7 Content API routes, native end-user endpoints, click matrix, scope boundaries, and acceptance strategy.

- [x] G2: Existing route paths, methods, response envelopes, permissions, owner checks and native/legacy branches pass focused regression tests.
  CHECK: node --test tests/route-contracts.test.js tests/native-session-routes.test.js tests/content-api-permissions.test.js tests/session-controller-delete.test.js
  EXPECT: # fail 0
  EVIDENCE: 36/36 focused route tests passed. They cover every inventoried admin and Content API route, protected access, route envelopes, user ownership, current-session denial, idempotent native/legacy paths, and session deletion.

- [x] G3: The full plugin suite covers the completed UI action matrix, API contracts, privacy and regressions.
  CHECK: npm test
  EXPECT: # fail 0
  EVIDENCE: Fresh final quality run on 2026-10-16 passed 336 tests, 0 failures.

- [x] G4: Backend and frontend types, package verification, runtime bundle verification and plugin build pass.
  CHECK: npm run test:ts:back && npm run test:ts:front && npm run verify && npm run verify:runtime && npm run build
  EXPECT: Done
  EVIDENCE: Fresh `node scripts/plugins.mjs Magic-Sessionmanager quality` passed 336 tests, both TypeScript checks, package verification, runtime bundle verification and the production plugin build. It ended with `ALL PLUGIN QUALITY GATES PASSED`.

- [x] G5: The shared Strapi admin application builds from the current Session Manager checkout.
  CHECK: cd ../.. && npm run app:build
  EXPECT: Building admin panel
  EVIDENCE: Fresh `npm run app:build` passed on the workbench's pinned Strapi 5.58.0 host after the final plugin UI changes.

- [x] G6: The integration host uses a new isolated database and a loopback port distinct from the existing 127.0.0.1:1337 service before any test data is created.
  EVIDENCE: Full acceptance ran on 127.0.0.1:1340 with `test-app/.tmp/sessionmanager-live.QUkM30/data.db`; its database and synthetic test accounts were removed. A final no-credential boot smoke ran on 127.0.0.1:1341 with a separate temporary SQLite database, opened only the first-admin setup screen, then removed the database and freed the port. Existing listeners on 127.0.0.1:1337 and 127.0.0.1:1338 were untouched.

- [x] G7: Every visible Session Manager control is exercised through Playwright CLI on desktop and mobile, including successful, empty, error, validation and confirmation states where applicable.
  EVIDENCE: Playwright CLI covered the dashboard search/status/page-size/export/detail/terminate/remove actions; Settings save/reset, security switches, number limits, GeoIP credential storage and provider-mocked update/force-refresh, geofencing mode and country add/remove, email-alert checkboxes and all template tabs/actions, and Clean Now confirmation; Analytics and Activation loading/retry, status, optional-key reveal/hide/copy/download using a fake key; Online Users states; and Users & Permissions panel retry, empty/populated state, terminate-all, block/unblock and cancel/confirm paths. Clipboard writes were stubbed, license/update network effects were mocked, and no email or provider call was sent.

- [x] G8: All affected screens pass the Strapi breakpoint matrix with measured document and component overflow, keyboard focus, accessible names, labels and console/network review.
  EVIDENCE: Playwright CLI measured Dashboard, General Settings, Analytics, Activation and the end-user panel at 320, 390, 519, 520, 767, 768, 1024, 1079, 1080 and 1440 CSS px. All 50 document-width checks had zero horizontal overflow. At 320x568 the Content Manager ActionsDrawer opened, its inner scroll exposed the final action without page overflow, and keyboard focus reached a session action with a visible focus state. No Session Manager console error occurred. The Content Manager also emitted Strapi-core 404s for its optional AI localization job and preview URL endpoints; they are outside this plugin's route namespace and are recorded in the acceptance plan.

- [x] G9: Each plugin-owned API route has an authorised success case and relevant anonymous, wrong-role, wrong-owner, invalid-input and failure case. Strapi-native session endpoints remain user-scoped.
  EVIDENCE: The 36 focused route tests and full plugin suite passed. Browser network evidence returned 200 for sessions, count-only user statistics, settings GET/PUT, GeoIP credential save/status, license status without a key, end-user session listing and session/user mutations. Fake GeoIP-update and license-status responses covered provider-facing UI paths. Native owner, current-session and legacy compatibility cases remain covered by their regression tests.

- [ ] G10: Browser/API evidence contains no credentials, tokens, raw session identifiers, personal data or internal exception details. No existing end-user or admin sessions are changed, and no external provider is contacted.
  EVIDENCE: All account, session, email and GeoIP data was synthetic and stored only in the isolated test database, which has been deleted. A Playwright CLI snapshot did serialize a generated password for the synthetic test user once. The exact snapshot and local password file were deleted, but the tool transcript cannot be edited. No production credential or existing user/admin session was involved. No provider was contacted.

- [x] G11: The full plugin quality command and shared-host startup are re-run after browser-driven fixes; the final Playwright sweep reflects the final code.
  CHECK: node ../../scripts/plugins.mjs Magic-Sessionmanager quality && cd ../.. && npm run app:build
  EXPECT: ALL PLUGIN QUALITY GATES PASSED
  EVIDENCE: On 2026-10-16 the plugin quality command passed 336 tests plus both type checks, package/runtime verification and plugin build; the shared Strapi 5.58.0 admin build also passed. A fresh boot loaded all eight configured plugin keys and logged successful SessionInfoPanel injection. Playwright CLI opened `/admin/auth/register-admin` without entering credentials and reported 0 console errors and 2 Strapi warnings. The full action sweep recorded in `docs/plans/2026-10-16-sessionmanager-functional-acceptance.md` verified the saved-user panel, Geofencing controls and Settings/Activation flows against the isolated host.

- [ ] G12: The installed Strapi dependency graph has no unresolved high-severity advisories.
  EVIDENCE: Rechecked 2026-10-16. `npm audit --omit=dev` reports five high findings in the plugin checkout via its required Strapi 5 peer chain; the shared host reports 30 high and 3 moderate transitive findings. `npm view` reports `@strapi/strapi@5.58.0` and `braces@3.0.3` as current latest, while GHSA-vfj7-8cjw-p6xm affects all `braces` versions through 3.0.3. `npm audit fix --dry-run --omit=dev` still leaves the advisories; the forced remediation downgrades Strapi to 4.26.2. No safe compatible fix is published, so no downgrade or unsupported override was applied.

ABANDON: G10 A generated local-only synthetic password appeared in the Playwright CLI transcript. Its exact snapshot artifact, local password file and isolated database have been removed, but the conversation transcript itself cannot be recalled. No real credentials, user data or sessions were exposed.

ABANDON: G12 The upstream `braces` advisory has no patched release. The suggested forced npm fix downgrades a Strapi 5 dependency to Strapi 4 and is incompatible with the supported host. Re-run the audit after the advisory or Strapi dependency chain is fixed.
