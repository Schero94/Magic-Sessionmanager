# Security activity of app users

Branch `feat/user-security-activity`, 2026-11-25, on top of 4.21.0. Synthetic data only (`*.example.test`, RFC 5737/3849 addresses); no production database was read.

## Facts checked in the installed source (Strapi 5.63.0, DS 2.3.1)

- `@strapi/content-manager` `services/permission-checker.js`: `create({ userAbility, model })` returns `can.read(entity, field)` / `cannot.read()`, with conditions and field-level permissions; the app-user email and username are returned only when `can.read(user, 'email' | 'username')`.
- `@strapi/design-system` 2.3.1 `RawTable` / cell: the grid gives `tabIndex=0` only to the cell at its current `coords`; the rows clone their cells with `coords`. A wrapper that does not pass them on (the plugin's `HeaderCell` since 4.19) leaves no cell focusable, so Tab skipped the table. Fixed, regression test in `tests/admin/user-activity-ui.test.jsx`.
- DS `Tag` renders a 28 x 28 px remove button; the filter chip is now DS `Flex` + `Typography` + `IconButton` (32 px).
- Strapi syncs every registered plugin action to the Super Admin role at start (`plugin::magic-sessionmanager.user-activity.read` present without a grant; HTTP test).
- Docs: Strapi "Admin permissions for plugins" via Context7 `/strapi/documentation` (registerMany, `admin::hasPermissions`), checked 2026-11-25.

## Tests

- [x] `npm test`: 1124 pass, 0 fail (new: `tests/user-activity-model.test.js`, `tests/user-activity-service.test.js`, `tests/user-activity-admin-model.test.mjs`, route inventory, impersonation refused-call target).
- [x] `tests/isolated-user-activity-http.test.js` on Strapi 5.63.0: 12/12 on SQLite, 12/12 on PostgreSQL 14 (throwaway local server, TCP only, deleted afterwards). RBAC (anonymous 401, Editor and access-only 403, Super Admin automatically 200, granted 200, revoked 403), a real failed sign-in, every event type and no admin event, email masking with field-level Content Manager permissions, admin names, impersonation reason, filters, paging and 400s, keyset export with the export audit, admin API token audit, anonymise and IP-off at read time, retention at read time, deletion with the user, no admin request data on admin-caused rows.
- [x] Existing real-HTTP suites on SQLite after the change: admin activity 18/18 (no proxy and trusted proxy), impersonation 19/19, policies 17/17, signals 14/14, admin sessions 14/14; on PostgreSQL: admin activity 18/18, impersonation 19/19.
- [x] `npm run test:admin`: 51 pass (new: App users section with and without the permission, full page with URL filters, Sessions panel with and without the permission, one Tab stop per table).
- [x] `lint`, `format:check`, `test:ts:front`, `test:ts:back`, `build`, `verify`, `verify:runtime` clean.
- [ ] Strapi 5.50.0 floor: runs in CI (`strapi-floor` job), not locally.

## Browser acceptance

Isolated host 127.0.0.1:1541, Strapi 5.63.0, plugin installed from the tarball packed at `c975a5d` (the same code as the head commit, which only adds this gate file; dist identical to the commit build), SQLite, random secrets in a mode-600 `.env`, egress blocked (server preload and browser routes), `admin.autoOpen: false`, headless Chromium (Playwright 1.65.1) in its own browser. Fixtures: a Super Admin, an auditor role with only `access` + `user-activity.read`, five app users (one 70-character email), 56 app-user events of all 14 types with times relative to now, plus two admin events that must not appear. Host stopped and `.env`, `creds.json` and the database deleted afterwards.

- [x] Matrix: App users tab section, full page, details dialog, full page filtered by one user, Content Manager Sessions panel (measured inside the panel), and the 4.19 admin Security activity page with an admin filter x 1440/1280/1080/1024/768/520/390/320 x light/dark = 96 stops. `documentOverflow` 0; `rowHeightMismatch`, `offScaleGaps`, `clippedText`, `lowContrast`, `elementsOutsideViewport`, inner horizontal scroll and off-screen row actions empty at every stop. `smallTargets`: only Strapi's own `BackButton` link (20-24 px tall), the same component and size as on Strapi's native pages.
- [x] Layout switches as designed: full table from 1280, table with "Done by" folded from 1024 to 1080, stacked rows from 768 down; the Sessions panel uses stacked rows.
- [x] Fixed during acceptance: tables unreachable by Tab (also the 4.19 admin lists), 28 px filter-chip remove button, the admin's own IP and browser shown on "Lock lifted" rows, an empty "What happened" row.
- [x] Keyboard at 1440 (table) and 390 (stacked): Tab reaches the list, focus ring on every stop, Enter and Space on the eye open the details, Escape returns focus to the eye; no focus on `BODY`.
- [x] Locales de, fr, es, pt, en at 1440 and 320: no overflow, clipping, small targets, contrast findings, leaked ICU placeholders or message ids; German uses Sie.
- [x] Auditor without Content Manager access to users: 18 rows "User #id", 0 email addresses, admin names as "Admin #id", no Admin panel view switch.
- [x] Console: 0 plugin errors or warnings. Core: React Router future-flag and `useRBAC` object warnings (also on `/admin`, Settings › Users and the Content Manager), the Content Manager edit view's `attribute` prop warning and its i18n AI-localization and preview 404s; egress: blocked non-loopback requests.
- [ ] Not checked in the browser: PostgreSQL/MySQL hosts (HTTP suite covers PostgreSQL), Strapi 5.50 (CI), screen-reader speech.
