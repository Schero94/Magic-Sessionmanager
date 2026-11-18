# Admin panel sessions (4.14.0)

Branch `feat/admin-sessions`, 2026-11-17. Design: `docs/plans/2026-11-17-admin-panel-sessions-design.md`. Synthetic data only (`*.example.test`); no production database was read.

## Fact: when does a revoked admin stop working?

Strapi 5.62.0 `@strapi/admin/dist/server/server/src/strategies/admin.js` calls `sessionManager('admin').isSessionActive(payload.sessionId)` on every admin request; `@strapi/core/dist/services/session-manager.js` `isSessionActive` returns false once the row is gone. So a sign-out takes effect on the admin's next request, not after `accessTokenLifespan` (default 1800 s). `isSessionActive` does not check `status`, so an access token bound to a `rotated` row survives `revokeSessionById` (which deletes only the active row) until its own expiry; the plugin therefore deletes every row of the device (`invalidateRefreshToken(userId, deviceId)`).

- [x] Proven over HTTP: `tests/isolated-admin-sessions-http.test.js` subtests "sign out one browser: next request 401, renewal 401" and "Strapi revokeSessionById alone leaves a rotated access token valid".
- [x] Proven in the browser: the signed-out admin's next click (Media Library) ended on `/admin/auth/login` after 802 ms; the panel's own `/admin/access-token` renewal answered 401.

## Tests

- [x] `npm test`: 849 pass, 0 fail, 0 skipped (local run includes the host-dependent suites against the workbench test-app, Strapi 5.58).
- [x] `tests/isolated-admin-sessions-http.test.js` against this repo's Strapi 5.62.0: SQLite 14/14, PostgreSQL 16 14/14 (13 subtests plus the suite) (admins signed in through `POST /admin/login`).
- [x] `tests/isolated-http-access.test.js` against Strapi 5.62.0: legacy 37/37, refresh 39/39 (route inventory updated to 25 dev routes).
- [x] `npm run lint`, `npm run format:check`, `test:ts:front`, `test:ts:back`, `build`, `verify`, `verify:runtime` clean.
- [x] `npm audit --omit=dev`: unchanged baseline, 5 high, all picomatch GHSA-fc5q-39xc-vjpf through `@strapi/utils` (documented in the README); the new devDependency `@strapi/plugin-users-permissions` 5.62.0 is not in the production tree.

## Browser acceptance

Isolated host 127.0.0.1:1387, Strapi 5.62.0, packed tarball, SQLite, `jwtManagement: 'refresh'`, random secrets, egress blocked (only expected attempt: `api.github.com` releases, blocked). Playwright 1.65.1, Chromium; `measure.js` from the workbench skill. Fixtures: 29 synthetic admins (Super Admin, Editor, Author, a read-only role, a delegated revoker role, one invited, one deactivated).

- [x] Matrix: 5 screens (App users view, admin list, sessions dialog, own sessions dialog, sign-out-everywhere confirmation) x 10 widths (1440, 1280, 1080, 1079, 1024, 768, 767, 520, 390, 320) x light/dark = 100 stops. documentOverflow 0, rowHeightMismatch, offScaleGaps, clippedText, smallTargets, lowContrast, elementsOutsideViewport all empty, no action outside the viewport, no inner horizontal scroll.
- [x] Fixed during acceptance: DS primary badge 2.43:1 in dark ("You", "This browser"); confirmation body without `Dialog.Description` (Radix warning); filter select not full width at 390/320.
- [x] Note: once a light-theme stop at 768 measured the DS danger button at 3.3:1 because the mouse hovered it after the click that opened the dialog (DS hover colour); re-measured 0 findings with the pointer moved away.
- [x] Click paths (24/24 checks): see who is signed in 1, find an admin 2, sign one browser out 3 + confirm, sign out everywhere 2 + confirm, self sign-out 3 + confirm (warning shown, Cancel returns focus to the trigger), deactivate via Strapi 3.
- [x] Second browser (Clara, Chrome): working before; after the sign-out her next click lands on the login page.
- [x] States: load error with Try again (mocked 500), retry loads; unsupported host (mocked); no results with Clear filters; read-only role sees no sign-out buttons; delegated role sees no sign-out for Super Admins and an explanation; Editor without plugin access gets Strapi's no-permission page and no menu link.
- [x] Keyboard: 45 Tab stops, focus never lost on the page (BODY only when the browser wraps past the document end); Escape closes the dialog and focus returns to "View sessions"; after "Sign out everywhere" focus moves to the list caption. Search input and Strapi pagination links show their focus ring on a wrapper or pseudo-element (DS / Strapi components), not on the element itself.
- [x] Locales de, fr, es, pt at 1440 and 320: no ICU or id leaks, no English, overflow 0, no clipping, no low contrast.
- [x] Console: 0 plugin messages, except the deliberate `[adminPanel.load] Request failed (HTTP 500)` warning for the mocked load error. Core: `useRBAC` object warning and React Router future-flag warning (also on `/admin/auth/login` and native pages). Egress: blocked `api.github.com`. Expected: 401s in the signed-out browser.
- [x] Screenshots for README and Pages from the same synthetic host, opened and checked (no real data, no tokens, `127.0.0.1` only): `docs/site/img/admin-panel*.webp` (240 KB total).

## Open

- [ ] CI on the pull request (the workflow runs on `pull_request` only).
- [ ] MySQL: not run (no local server). The queries use the Query Engine only (`$in`, `$notIn`, `$containsi`, `$null`, `$gt`).
