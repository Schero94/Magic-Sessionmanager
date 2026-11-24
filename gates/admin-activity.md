# Security log: admin sign-in history and Content Manager activity

Branch `feat/admin-sign-in-history-activity`, 2026-11-24, on top of 4.14.3. Synthetic data only (`*.example.test`, RFC 5737/3849 addresses); no production database was read.

## Facts checked in the installed source (Strapi 5.63.0)

- `@strapi/admin` `controllers/authentication.js`: the login emits `admin.auth.success` ({ user, provider }) and, for local failures, `admin.auth.error` ({ error, provider, reason, user? }) after Strapi's own lookup of the typed email (`emitLocalLoginFailure`, also in 5.58 and 5.62). `logout` emits `admin.logout`. A body that fails validation (for example a malformed `deviceId`) emits nothing.
- `@strapi/core` `services/request-context.js`: every request runs inside an AsyncLocalStorage; `strapi.requestContext.get()` returns the Koa context inside event hub listeners.
- `@strapi/admin` `middlewares/rateLimit.js`: `admin::rateLimit` answers 429 (`RateLimitError`) before the controller, keyed on email, path and `ctx.request.ip`; no event.
- `@strapi/core` `services/server/compose-endpoint.js`: `ctx.state.route` (with `info.pluginName` and `handler`) is set before authentication, so it is present after `next()`, also for 429.
- `@strapi/core` `services/server/index.js`: Koa gets `proxy`, `proxyIpHeader` and `maxIpsCount` from `server.proxy`.
- `@strapi/design-system` 2.3.1 table cell (`RawTd`) calls `preventDefault()` on every key when a cell holds only buttons: Enter and Space on the row buttons did nothing until the row actions stop those keys (fixed here, test added).

## Tests

- [x] `npm test`: 901 pass, 0 fail (includes the host suites against the workbench test-app, Strapi 5.58).
- [x] `tests/isolated-admin-activity-http.test.js` against this repo's Strapi 5.63.0: 13/13 without proxy, 13/13 with `ADMIN_ACTIVITY_PROXY=1`; repeated four times after fixing a flush race (a flush with an empty queue left `flushing` set; regression test in `tests/security-log-service.test.js`).
- [x] Strapi 5.50.0 floor: 13/13. On 5.50 `admin.auth.error` carries no `user`; the failed attempt is then linked by resolving the typed email to an existing admin in the background (never stored). Found by the CI floor job, regression test in `tests/security-log-service.test.js`.
- [x] `npm run test:admin`: 16 pass (new: activity tabs, recent list, settings tab, no activity requests without the permission, row keys).
- [x] `lint`, `format:check`, `test:ts:front`, `test:ts:back`, `build`, `verify`, `verify:runtime` clean.

## Performance

- [x] `scripts/bench-admin-activity.cjs`, 1,000 Content Manager requests per run, three runs per mode, alternating: off mean 4.65-5.22 ms (p95 6.17-7.14), on mean 4.65-4.82 ms (p95 6.16-6.35), 500-575 events stored per run. No measurable difference.

## Browser acceptance

Isolated host 127.0.0.1:1431, Strapi 5.63.0, plugin installed from the packed 4.14.3 tarball of this branch, SQLite, random secrets, `server.proxy: { koa: true, maxIpsCount: 1 }`, egress blocked, `admin.autoOpen: false`, headless Chromium (Playwright 1.65.1) only. Fixtures created through Strapi's own routes: five admins (Super Admin, Editor, Author, a second Super Admin with a long name and an IPv6 address), sign-ins with `X-Forwarded-For` from documentation ranges, failed attempts (known and unknown email), a lockout (429), a sign-out, a plugin sign-out of one browser, Content Manager create, edit, publish, open, delete and a single type.

- [x] Before/after: row button gap 0 px (4.14.2) and 4 px (this branch), light and dark.
- [x] Matrix: admin panel page, details dialog (Sign-in history), details dialog (Activity), Settings › Admin activity x 8 widths (1440-320) x light/dark = 64 stops. documentOverflow 0; rowHeightMismatch, offScaleGaps, clippedText, smallTargets, lowContrast, elementsOutsideViewport and inner horizontal scroll all empty.
- [x] Fixed during acceptance: text button and entry link targets below 24 px (now 32 px), DS primary badge 2.43:1 in dark on "Edited"/"Created" (now neutral), event lists not full width in the recent card, dialog body scrolling sideways at 320 px in German (tabs now scroll inside their own list), Enter/Space on table row buttons.
- [x] Locales de, fr, es, pt, en at 1440 and 320 (history tab and settings tab): no overflow, clipping, small targets, contrast findings or leaked ICU placeholders or message ids.
- [x] Keyboard: Enter and Space on "View sessions" open the dialog; Escape returns focus to the trigger; the name buttons in the recent card show the DS focus ring (pseudo-element). BODY appears once when the walk wraps past the end of the document.
- [x] Console: 0 plugin errors or warnings; the only messages are blocked `api.github.com` requests (Strapi's update check, egress).
- [ ] Not checked in the browser: SSO sign-ins (Enterprise feature, no provider in the host), PostgreSQL/MySQL hosts (the HTTP suite runs on PostgreSQL in CI only through the admin sessions job; the security log suite runs on SQLite).
