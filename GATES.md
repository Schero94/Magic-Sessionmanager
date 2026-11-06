# Session Manager mobile, desktop, API and security gates

## Release status (read first)

- **4.8.0 was released before acceptance.** The semantic-release commit `c9ba929 chore(release): 4.8.0` is on `main`, although the release-readiness audit it ships (`docs/audits/2026-11-06-release-readiness.md:3`, committed in `de22602`, an ancestor of `c9ba929`) says "Status: incomplete. Do not publish this branch as a release yet." This cannot be undone. Whether npm actually published the package and whether the remote `v4.8.0` tag exists was not independently verified here, because registry and remote access were not allowed (GA-03).
- 4.8.0 is **not accepted**. Known defects in the released code (`c9ba929`), all confirmed in `docs/audits/2026-11-06-ui-acceptance-review.md`:
  - The Session Details dialog has no accessible name, because the header is Typography and not `Modal.Title`.
  - Settings field hints (including the GeoIP privacy disclosure) never render, because `Field.Hint` sits in a `Field.Root` without a `hint` prop.
  - Three Settings alerts have `closeLabel=""`, so their close buttons are unnamed.
  - Country chips cannot be removed by keyboard.
  - A failed block followed by a retry of the bodyless toggle unblocks the user.
  - In `legacy-support` mode a password reset leaves older sessions usable (GA-04).
- The **next release must carry the fixes** from `claude/sessionmanager-ui-redesign` and must only be cut after N1–N6 below are closed. A release workflow that can publish while N-gates are open is itself an open item (see `gates/ui-redesign.md` R4).

## 2026-11-06 full acceptance continuation

The checked G-gates further down are historical evidence for checkout `2f00880` (4.7.2 + native sessions), measured on 2026-10-16 on the workbench host with Strapi 5.58.0. They are not proof for 4.8.0, for the acceptance branch or for the redesign branch. The current objective, ownership boundaries and leaf gates are in `docs/plans/2026-11-06-complete-acceptance.md`, `gates/complete-acceptance-*.md` and, for the redesign branch, `gates/ui-redesign.md`.

Root workbench gates (`../../gates/sessionmanager.md`, `../../gates/audit-sessionmanager.md`, `../../gates/pages-sessionmanager.md`) check `plugins/Magic-Sessionmanager` at `2f00880` (package version 4.7.2) and the workbench test-app (Strapi 5.58.0). They are historical for that checkout and are not acceptance for 4.8.0 or this branch (GA-07).

- [ ] N1: Every current admin, content and compatibility endpoint has an independently verified access, owner, input and error contract; all confirmed security defects have regression tests and fixes.
  EVIDENCE: in progress on the redesign branch. Regression tests now pass for per-route 429 budgets (API-1/API-2), write-limit tightening only (API-5), partial settings PUT (API-6), password-reset revocation (GA-04, both JWT modes), foreign-vs-absent session delete (API-10) and the restored bodyless toggle contract (GA-09/API-4). Isolated HTTP on Strapi 5.61.0 dependencies, 2026-11-06 ~17:40: legacy-support 38/38, refresh + `SESSION_HTTP_FALLBACK=1` 41/41. A2 is still open (races, partial writes, fallback rate limit, multi-process); see `gates/complete-acceptance-api.md`.
- [ ] N2: All reachable plugin screens and states conform to Strapi's current Design System, and every action is exercised in a real isolated host at desktop and mobile breakpoints, with keyboard, accessibility, clipping and console evidence.
  EVIDENCE: pending. The redesign is implemented in source with source-contract tests only; no browser run on the redesigned build exists yet (`gates/ui-redesign.md` B1–B3).
- [ ] N3: Privacy and external-provider behavior are explicitly disclosed, safe by design, tested without external effects and compatible with existing deployments.
  EVIDENCE: pending. The README and Settings disclose the `auto` → ipapi.co default; the consent/legal-basis decision for that default is still open.
- [ ] N4: Dependency advisories are triaged with current evidence; compatible safe remediations are verified and residual risks explicitly recorded.
  EVIDENCE: pending. Last recorded audit: 2 high package entries via Zod GHSA-mrhx-c7xc-m3w5 pinned by `@strapi/utils` 5.61.0; no compatible fix. Not re-run on this branch (no registry access).
- [ ] N5: Current plugin tests, type checks, build, package/runtime verification, isolated shared-host build/boot and final browser/API sweep pass on final code; open gates are not presented as complete.
  EVIDENCE: partial snapshot only. Redesign working tree, 2026-11-06 ~17:35, with `SESSION_HTTP_STRAPI_NODE_MODULES` pointing at the Strapi 5.61.0 host: full `node --test tests/*.test.js tests/*.test.mjs` = 627 tests, 609 pass, 0 fail, 18 todo (todo = pending i18n merge and non-strict symmetry contract). `npm run test:ts:front` and `npm run test:ts:back` exit 0. Build, verify, verify:runtime, host build/boot and browser sweep not run on this tree. Other agents were still editing.
- [ ] N6: Integrate, independently verify and report all leaf results with no credentials, production data, external side effects or unauthorized publication.
  EVIDENCE: pending. Note: 4.8.0 was published before this gate could close (see Release status).

### What concretely remains (GA-14)

- N1/A2: races and partial writes, current-session 202/404 over HTTP, other malformed IDs, DB failures, fallback-route rate limiting, multi-process and non-SQLite behaviour, unserialized opposing block/unblock requests.
- N2/U2/U4/I4 and `gates/ui-redesign.md` B1–B3: full breakpoint matrix (desktop first, then mobile) for every screen and state, keyboard walk, screen reader across five locales, browser recheck of the block request, user-panel long data.
- N3: consent/legal-basis decision for the default `geolocation=auto`.
- N4/G12: Zod advisory via `@strapi/utils`; host audit.
- N5/I2/I3: final full suite on the 5.61 host after all edits, clean-install build and verify, shared eight-plugin host boot.
- N6/I1/I5/I6: integration report.
- G10: ABANDON stays (synthetic password once in a transcript).

Scope: Continue the approved Strapi-native UI direction for Users & Permissions end-user sessions. Keep Strapi Admin sessions, unrelated plugins, live user data and external provider effects out of scope.

## Historical gates (checkout `2f00880`, 2026-10-16, workbench host Strapi 5.58.0)

- [x] G1: Current-state, target-state, route inventory and click/API acceptance matrix are recorded for every Session Manager screen.
  CHECK: test -f docs/plans/2026-10-16-sessionmanager-functional-acceptance.md && rg -q "Current state" docs/plans/2026-10-16-sessionmanager-functional-acceptance.md && rg -q "Target state" docs/plans/2026-10-16-sessionmanager-functional-acceptance.md && echo FUNCTIONAL_SPEC_PRESENT
  EXPECT: FUNCTIONAL_SPEC_PRESENT
  EVIDENCE: `docs/plans/2026-10-16-sessionmanager-functional-acceptance.md` records the current pages, the unsaved-user and empty-blocklist defects found, all 20 admin and 7 Content API routes, native end-user endpoints, click matrix, scope boundaries, and acceptance strategy.

- [x] G2: Existing route paths, methods, response envelopes, permissions, owner checks and native/legacy branches pass focused regression tests.
  CHECK: node --test tests/route-contracts.test.js tests/native-session-routes.test.js tests/content-api-permissions.test.js tests/session-controller-delete.test.js
  EXPECT: # fail 0
  EVIDENCE: Historical, 2026-10-16: 36/36 focused route tests passed. They cover every inventoried admin and Content API route, protected access, route envelopes, user ownership, current-session denial, idempotent native/legacy paths, and session deletion.

- [x] G3: The full plugin suite covers the completed UI action matrix, API contracts, privacy and regressions.
  CHECK: npm test
  EXPECT: # fail 0
  EVIDENCE: Historical, 2026-10-16: 336 tests, 0 failures. The current count on the redesign tree is in N5.

- [x] G4: Backend and frontend types, package verification, runtime bundle verification and plugin build pass.
  CHECK: npm run test:ts:back && npm run test:ts:front && npm run verify && npm run verify:runtime && npm run build
  EXPECT: Done
  EVIDENCE: Historical, 2026-10-16: `node scripts/plugins.mjs Magic-Sessionmanager quality` passed 336 tests, both TypeScript checks, package verification, runtime bundle verification and the production plugin build. It ended with `ALL PLUGIN QUALITY GATES PASSED`.

- [x] G5: The shared Strapi admin application builds from the current Session Manager checkout.
  CHECK: cd ../.. && npm run app:build
  EXPECT: Building admin panel
  EVIDENCE: Historical, 2026-10-16: `npm run app:build` passed on the workbench's pinned Strapi 5.58.0 host. Not repeated on Strapi 5.61 for 4.8.0 or this branch.

- [x] G6: The integration host uses a new isolated database and a loopback port distinct from the existing 127.0.0.1:1337 service before any test data is created.
  EVIDENCE: Full acceptance ran on 127.0.0.1:1340 with `test-app/.tmp/sessionmanager-live.QUkM30/data.db`; its database and synthetic test accounts were removed. A final no-credential boot smoke ran on 127.0.0.1:1341 with a separate temporary SQLite database, opened only the first-admin setup screen, then removed the database and freed the port. Existing listeners on 127.0.0.1:1337 and 127.0.0.1:1338 were untouched.

- [ ] G7: Every visible Session Manager control is exercised through Playwright CLI on desktop and mobile, including successful, empty, error, validation and confirmation states where applicable.
  STATUS: SUPERSEDED and not valid for 4.8.0 (GA-02). Re-close only through N2/I4 with evidence from the current build.
  EVIDENCE (historical, 2026-10-16): Playwright CLI clicked the dashboard search/status/page-size/export/detail/terminate/remove actions, the Settings save/reset/switch/number/GeoIP/geofencing/email/Clean Now controls, Analytics and Activation loading/retry/reveal/copy/download, Online Users states and the Users & Permissions panel actions. Clipboard writes were stubbed, license/update network effects were mocked, and no email or provider call was sent. The run did not detect that country chips cannot be operated by keyboard and that Settings hints never render (`integration.md`, `ui.md`), so "every control exercised" was not supported.

- [ ] G8: All affected screens pass the Strapi breakpoint matrix with measured document and component overflow, keyboard focus, accessible names, labels and console/network review.
  STATUS: SUPERSEDED, and the accessible-name claim was false when it was made (GA-02). `git diff --stat 2f00880 c9ba929 -- admin/` is empty, so the same admin code shipped in 4.8.0 with: no accessible name on Session Details (no `Modal.Title`), focus on BODY after Escape, no rendered `Field.Hint`, three alerts with `closeLabel=""` and keyboard-inaccessible country chips.
  EVIDENCE (historical, 2026-10-16): Playwright CLI measured Dashboard, General Settings, Analytics, Activation and the end-user panel at 320, 390, 519, 520, 767, 768, 1024, 1079, 1080 and 1440 CSS px; all 50 document-width checks had zero horizontal overflow. That proves document overflow only. Accessible names and labels were not actually verified.

- [ ] G9: Each plugin-owned API route has an authorised success case and relevant anonymous, wrong-role, wrong-owner, invalid-input and failure case. Strapi-native session endpoints remain user-scoped.
  STATUS: SUPERSEDED by A2/N1 (GA-05, API-2). The cited evidence (36 focused route tests plus browser 200s) does not show wrong-role, failure or 429 cases per route, and `gates/complete-acceptance-api.md` A2 is open. The isolated HTTP matrix behind it ran on Strapi 5.58.0, not on the 5.61 target (GA-08).
  EVIDENCE (historical, 2026-10-16): The 36 focused route tests and full plugin suite passed. Browser network evidence returned 200 for sessions, count-only user statistics, settings GET/PUT, GeoIP credential save/status, license status without a key, end-user session listing and session/user mutations.

- [ ] G10: Browser/API evidence contains no credentials, tokens, raw session identifiers, personal data or internal exception details. No existing end-user or admin sessions are changed, and no external provider is contacted.
  EVIDENCE: All account, session, email and GeoIP data was synthetic and stored only in the isolated test database, which has been deleted. A Playwright CLI snapshot did serialize a generated password for the synthetic test user once. The exact snapshot and local password file were deleted, but the tool transcript cannot be edited. No production credential or existing user/admin session was involved. No provider was contacted.

- [ ] G11: The full plugin quality command and shared-host startup are re-run after browser-driven fixes; the final Playwright sweep reflects the final code.
  STATUS: SUPERSEDED and not valid for 4.8.0 (GA-02). The "final sweep" did not reflect a final, accepted state: later browser checks on the same admin code found the dialog-name, focus, hint, alert-label and country-chip defects listed in Release status.
  EVIDENCE (historical, 2026-10-16): The plugin quality command passed 336 tests plus both type checks, package/runtime verification and plugin build; the shared Strapi 5.58.0 admin build also passed. A fresh boot loaded all eight configured plugin keys. Playwright CLI opened `/admin/auth/register-admin` without credentials and reported 0 console errors and 2 Strapi warnings.

- [ ] G12: The installed Strapi dependency graph has no unresolved high-severity advisories.
  EVIDENCE: Rechecked 2026-10-16. `npm audit --omit=dev` reports five high findings in the plugin checkout via its required Strapi 5 peer chain; the shared host reports 30 high and 3 moderate transitive findings. `npm view` reports `@strapi/strapi@5.58.0` and `braces@3.0.3` as current latest, while GHSA-vfj7-8cjw-p6xm affects all `braces` versions through 3.0.3. `npm audit fix --dry-run --omit=dev` still leaves the advisories; the forced remediation downgrades Strapi to 4.26.2. No safe compatible fix is published, so no downgrade or unsupported override was applied. Later (2026-11-06) the 4.8.0 lockfile audit reports 2 high entries via Zod GHSA-mrhx-c7xc-m3w5 (`gates/complete-acceptance-privacy.md`).

ABANDON: G10 A generated local-only synthetic password appeared in the Playwright CLI transcript. Its exact snapshot artifact, local password file and isolated database have been removed, but the conversation transcript itself cannot be recalled. No real credentials, user data or sessions were exposed.

ABANDON: G12 The upstream `braces` advisory has no patched release. The suggested forced npm fix downgrades a Strapi 5 dependency to Strapi 4 and is incompatible with the supported host. Re-run the audit after the advisory or Strapi dependency chain is fixed.
