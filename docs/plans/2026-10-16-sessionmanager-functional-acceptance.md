# Session Manager functional and secure acceptance plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Verify and improve every active Session Manager UI action and API path on desktop and mobile while preserving Strapi-native Users & Permissions end-user session ownership and legacy compatibility.

**Architecture:** Keep Strapi's `users-permissions` session manager authoritative in refresh mode and retain the existing Magic endpoints and response envelopes. Keep the current Strapi Design System layout direction. Fix only defects demonstrated by source, tests, or Playwright. Use a new isolated Strapi database, synthetic end users, and local provider fakes. Do not use the existing `127.0.0.1:1337` process or any existing user or administrator session.

**Tech Stack:** Strapi 5.58.0, `@strapi/design-system` 2.2.4, React, Node 22, `node:test`, the shared Strapi test app, and Playwright CLI.

---

## Current state

- The plugin already has Strapi-native dashboard, settings, analytics, optional activation, session details, and an end-user session panel in the Users & Permissions user editor. The Online Users widget is also registered.
- `ActiveSessions.jsx` is exported but has no registration or navigation entry. Confirm it is not reachable before deciding whether it needs browser coverage.
- Strapi's native session API is correctly scoped to the authenticated Users & Permissions end user. Strapi 5.58.0's public manager exposes user-scoped listing and revocation. Strapi Admin authentication and sessions remain outside this plugin's scope.
- The baseline `npm test` passes 285 tests. Existing browser evidence covers parts of the dashboard, settings, analytics, activation, details modal, exports, and the end-user panel at 390 px and 1440 px. It does not demonstrate every settings mutation, every confirmation, all API success and deny paths, or the full Strapi breakpoint matrix.
- Several admin components log raw HTTP error objects to the browser console. Those objects may contain request configuration or response data. The activation page also renders the stored license key as plain text by default.
- `Initializer` sends a periodic request to the optional license status endpoint as an administrator-session heartbeat. Strapi Admin sessions are not part of this plugin's scope, and the status endpoint may contact the license provider when a key is present.
- The Online Users widget requests one complete user record merely to read the Content Manager pagination total. If the count calls fail, it renders zero for unavailable counts without telling the administrator.
- The Users & Permissions panel also renders session actions while the create form has no persisted user ID. The `Block User` button looks enabled but its handler returns without making a request, so the unsaved state is misleading.
- Geofencing derives its selected mode from whichever country list is non-empty. With both lists empty, clicking Blocklist clears the current list and the UI immediately returns to Allowlist, so an administrator cannot add the first blocked country.
- Admin API routes have a shared administrator-authentication and plugin-permission policy. Content API routes use Users & Permissions authentication and rate limits. The existing route and owner tests cover important compatibility cases, but they do not replace browser-driven action coverage.

## Target state

- Every reachable button, link, switch, selector, form action, table-row action, modal action, retry action, export action, and confirmation is mapped to its expected result and verified with Playwright CLI.
- Every plugin API route has an expected authenticated success case and the relevant anonymous, unauthorized, invalid-input, failure, or wrong-owner case. Preserve all existing paths, methods, permissions, legacy behavior, and response envelopes.
- The dashboard, Settings, Analytics, Activation, details modal, Online Users widget, and Users & Permissions end-user panel work at mobile, tablet, and desktop widths. No unrelated page content overflows horizontally. Tables may scroll only inside their labelled table region.
- On a new, unsaved Users & Permissions entry, the panel explains that the user must be saved before session management is available. It does not show a false zero-session state or enabled no-op actions.
- The Geofencing form keeps the selected allowlist/blocklist mode while its active list is empty, so the first country can be added. Existing `allowedCountries` and `blockedCountries` API settings remain unchanged; no new backend field is introduced.
- User-visible errors remain actionable. Browser and server logs contain only safe status or error-class information, never raw errors, tokens, cookies, license keys, email addresses, IP addresses, or session identifiers.
- The activation key is masked by default. Revealing, copying, or downloading it remains a deliberate operator action. No key, email, or session data is captured in browser artifacts.
- The plugin does not send heartbeat requests to extend Strapi Admin sessions. Existing plugin UI and end-user session behavior remain intact.
- Online Users obtains aggregate end-user counts from a permission-protected count-only plugin API. It never downloads user records for a dashboard count. Failed session or count requests render an explicit retry or partial-data state instead of false zeroes.
- All tests use a fresh local Strapi database and synthetic `example.invalid` Users & Permissions accounts. MaxMind, GeoIP, email, webhook, license-server, and other external effects use fakes or remain untriggered.

## API contract inventory

The admin API contains 20 normal routes and one development-only test route:

| Surface | Method and path suffix | Expected use |
| --- | --- | --- |
| Sessions | `GET /sessions`, `GET /sessions/active`, `GET /user/:userId/sessions` | Dashboard, active list, end-user panel |
| Session actions | `POST /sessions/:sessionId/terminate`, `DELETE /sessions/:sessionId`, `POST /sessions/clean-inactive`, `POST /user/:userId/terminate-all`, `POST /user/:userId/toggle-block` | Confirmed session and user actions |
| User counts | `GET /users/stats` | Online Users widget. Returns counts only, no user records |
| Activation | `GET /license/status`, `POST /license/auto-create`, `POST /license/create`, `POST /license/ping`, `POST /license/store-key` | Optional activation, with provider calls stubbed |
| Geolocation | `GET /geolocation/:ipAddress` | Details modal, with provider calls disabled or stubbed |
| GeoIP | `GET /geoip/status`, `PUT /geoip/credentials`, `POST /geoip/update` | Local status and credential/update flows, without MaxMind calls |
| Settings | `GET /settings`, `PUT /settings` | Load, save, and reset settings |
| Development only | `POST /sessions/:sessionId/simulate-timeout` | Verify it is unavailable outside development |

The Content API has seven routes:

| Method and path suffix | Expected use |
| --- | --- |
| `POST /logout`, `POST /logout-all`, `POST /logout-others` | Authenticated user's native or legacy session lifecycle |
| `GET /my-sessions`, `GET /current-session`, `GET /user/:userId/sessions` | Current user's session views and owner checks |
| `DELETE /my-sessions/:sessionId` | Revoke an owned, non-current session |

Strapi's native session routes are separately verified: `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:sessionId`, `POST /api/auth/logout`, and refresh rotation. They must remain end-user scoped. Do not call any Strapi Admin session APIs.

## UI action matrix

### Dashboard

- Load sessions, retry a failed load, search, change status, change page size, move backward and forward, verify first and last page bounds, clear filters, and open a session from both the desktop table and mobile card.
- Open and close the detail modal, show and hide technical details, terminate an active synthetic session through the confirmation flow, and remove inactive synthetic session details while preserving token revocation.
- Click CSV and JSON export with browser download interception. Check row counts, headers, and absence of token fields without saving or printing user data.

### Settings

- Open every accordion and tab. Exercise all switches, selects, checkboxes, text inputs, number inputs, allowlist/blocklist controls, add/remove country actions, save, reset, and validation feedback. Save only to the isolated test database and restore the initial settings before shutdown.
- Generate, show, and hide a synthetic encryption key. Stub clipboard writes and verify only completion state, never the key itself.
- Click each email-template variable action for every available template type. Exercise load-default, local validation, template details, copy, and reset actions with clipboard and notification output stubbed.
- Verify MaxMind credential fields stay masked, credential-save remains unavailable without test credentials, and database download/force-refresh controls stay disabled when credentials are absent. Cover the server endpoint with fakes, not a provider request.
- Run inactive cleanup only against inactive records created in this isolated test database and confirm the access-token deny guarantee remains.

### Analytics, Activation, and shared UI

- Load Analytics and retry an injected failure. Verify empty and populated charts.
- Load the optional Activation page, refresh status, and expand each accordion. Do not create or verify a real license. If a synthetic key state is needed to cover copy/download controls, stub the status response and intercept clipboard/download handling without retaining its contents.
- Verify Online Users loading, empty, partial-user-count failure, and retry behavior. Confirm metric cards are not clickable without destinations.
- Verify Users & Permissions user-panel loading, retry, empty and populated states, logout-all confirmation, and block/unblock confirmation for a synthetic end user. Do not open or mutate Strapi Admin user sessions.
- Open the unsaved Users & Permissions user-creation view and verify the save-first explanation is visible while session actions are absent or disabled.
- With Geofencing enabled and both lists empty, switch modes, add the first country to each mode, switch back, and remove it. Verify mode changes remain a local draft until settings are saved.

## Responsive and accessibility matrix

Use Playwright CLI at `320, 390, 519, 520, 767, 768, 1024, 1079, 1080, and 1440` CSS-pixel widths. At each active screen, record `scrollWidth` and `clientWidth`, component/table overflow, clipping, wrapped copy, focused controls, labels, switch names and states, and console errors. Exercise keyboard navigation, Enter/Space activation, Escape and modal close behavior. Use desktop and mobile heights that expose both short and long content.

## Implementation order

1. Add failing tests for privacy-safe frontend error logging, the absence of the administrator-session heartbeat, the no-ID Users & Permissions panel state, and empty-list Geofencing mode selection.
2. Make the smallest backend or frontend fixes required by failing tests. Preserve the current route, permission, response, and legacy contracts.
3. Add or extend focused API and UI contract tests for any newly discovered defect before changing that behavior.
4. Run plugin unit tests, backend/frontend type checks, package verification, runtime verification, and plugin build.
5. Build the shared Strapi admin application.
6. Start a new isolated test database on a free loopback port distinct from `127.0.0.1:1337`, create a disposable local administrator through the setup UI, and create synthetic end users. Do not read or reuse credentials from `user.txt`, `.env`, old browser state, or exposed output.
7. Run the full Playwright CLI action and responsive matrix against the isolated host. Stub clipboard, downloads, license requests, GeoIP, email, webhooks, and any other external effects.
8. Re-run the complete plugin quality suite after browser fixes. Stop only the process launched for this isolated test, and leave the existing `127.0.0.1:1337` service and database untouched.

## Non-goals

- No Strapi Admin session integration or administrator-session termination.
- No migration of the host application's Users & Permissions configuration, no automatic data migration, and no change to the default legacy mode.
- No real user, administrator, license, MaxMind, email, webhook, GeoIP, or external provider data or side effects.
- No commits, pushes, releases, or changes to other plugins.

## Verification record, 2026-10-16

- `node scripts/plugins.mjs Magic-Sessionmanager quality` passed 324 tests, backend and frontend TypeScript checks, package verification, runtime bundle verification, and the production plugin build.
- The focused API-contract and ownership suite passed 36/36 tests. `npm run app:build` passed with the Strapi 5.58.0 host.
- Playwright CLI measured Dashboard, General Settings, Analytics, Activation, and the Users & Permissions end-user panel at 320, 390, 519, 520, 767, 768, 1024, 1079, 1080, and 1440 CSS px. All 50 document-width checks reported zero horizontal overflow. At 320x568 the Content Manager ActionsDrawer opened, its inner scroll brought the final session action into view, and keyboard focus reached a session action with a visible focus indicator.
- The unsaved-user panel now shows a save-first message and no session actions. Geofencing keeps an empty Blocklist selected, supports adding and removing the first country in either mode, persists the selected non-empty list through `PUT /settings`, and reloads the saved mode. The test setting was restored to its initial value.
- Settings Save and Reset calls returned HTTP 200. Saving fake MaxMind credentials returned HTTP 200; `GET /geoip/status` returned `hasCredentials` without the fake key. GeoIP update and force-refresh UI actions used Playwright network fakes. The license page status returned HTTP 200 without a stored key. A fake status response covered key reveal, hide, copy with a clipboard stub, and download without retaining the file. No email or external provider request was sent.
- The isolated database was `test-app/.tmp/sessionmanager-live.QUkM30/data.db` on `127.0.0.1:1340`. The process was stopped, the database directory was removed, and listeners on 1337, 1338, and 1339 were left untouched.
- The Content Manager emits Strapi-core 404s for the optional AI localization job and preview URL endpoints when editing a Users & Permissions user. No Session Manager API error occurred on the affected pages.
- One raw Playwright CLI snapshot briefly included a generated password for the synthetic local test user. Its snapshot file and temporary password file were removed, and the isolated database was deleted. The tool transcript cannot be edited. No production credential or real user data was involved.
- A dependency audit found five high advisories through the host-provided `@strapi/utils@5.58.0` chain to `braces@3.0.3`. GitHub lists no patched `braces` version. The forced npm fix would downgrade a Strapi 5 dependency to 4.26.2, so it was not applied. Track this upstream risk and rerun the audit when a compatible fix is available.

## 2026-10-16 modal and warning follow-up

- `ActiveSessions.jsx` is an exported but unregistered placeholder. There is no separate Active Sessions route; the Dashboard exposes active sessions through its status filter, so this follow-up did not add duplicate navigation.
- Focused regressions cover the Alert layout and dismissal, semantic modal label/value pairs, safe wrapping, browser versions, locale-aware timestamps, missing timestamp fallbacks and logout labels. The layout tests were run red before implementation and green after. A source review also caught the warning's visible X had no `onClose`; the close and strict-mode reset behavior now have a regression test.
- `node scripts/plugins.mjs Magic-Sessionmanager quality` passes 336 tests, frontend and backend TypeScript checks, the plugin build, package verification and runtime verification. `npm run app:build` passes with Strapi 5.58.0.
- Playwright CLI verified the relaxed-mode warning at 320, 390, 519, 520, 767, 768, 1024, 1079, 1080 and 1440 CSS px. Title and body start at the same x coordinate, the document does not overflow, the close button dismisses the warning, and toggling strict mode on and back off restores it. No settings were saved.
- A populated synthetic details modal was checked at the same widths. Values stayed paired with labels, browser and date details rendered, long fields did not overflow, the user-agent disclosure worked, and Escape closed the modal. The body scrolls within the dialog on a short 320 x 568 viewport.
- Canceling the modal logout confirmation sent no mutation. Accepting it sent one mocked POST to `/magic-sessionmanager/sessions/fixture-session-01/terminate`, returned success, refreshed the dashboard and closed the modal. The inactive row then showed a disabled logout button.
- A synthetic Users & Permissions record was added only to the isolated preview database. The side panel rendered a mocked active session. Canceling bulk logout sent no POST; confirming sent one mocked POST to `/magic-sessionmanager/user/:userId/terminate-all` and changed the panel to Offline / 0 current sessions. No real session or provider was touched.
- Existing backend tests cover authentication, plugin RBAC, owner boundaries, legacy compatibility and token revocation. Browser route interception verifies the UI request and state transitions, not live backend integration. Content Manager's unrelated i18n and preview calls still return 404 in this local host.
- The first preview startup sent three standard Strapi telemetry events before telemetry was disabled. Later preview restarts used `STRAPI_TELEMETRY_DISABLED=true`. Payloads were not inspected. Port 1338 and its database were left untouched.
