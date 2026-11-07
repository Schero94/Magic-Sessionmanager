# Finish: license removal, clean installs, docs

Branch `chore/finish-free-docs` (worktree `.tmp/fin-sm`), base `7388df6` (4.10.0). Owner decision: no license feature and no installation ping or telemetry of any kind. Release type: minor (see CHANGELOG `[Unreleased]`, "Version decision").

All evidence below is from 2026-11-07 on this branch. Hosts: Strapi 5.61.0, Node 22.23.1, synthetic data only (`*.example.test`), outbound network blocked on every Strapi host.

## Code

- [x] L1: No license page, settings link, guard, controller, service, routes, translations or license-server call remains.
      CHECK: `node --test tests/license-removal.test.js` and `grep -rniE "magicapi|fitlex|license-guard|LicenseGuard|/api/licenses" server/src admin/src dist`
      EXPECT: 5 of 5 pass; no grep hit.
      EVIDENCE: 5/5 pass; `dist` built from this tree has no hit ("dist clean").
- [x] L2: Former license rows are deleted at startup, idempotently and safely in parallel.
      CHECK: isolated HTTP test "the removed license routes are gone and former license rows are deleted idempotently" (`node --test tests/isolated-http-access.test.js`); real boot on the isolated host with 4 seeded rows (`licenseKey` twice, `lastValidated`, `deviceId`).
      EXPECT: two parallel cleanups delete every row once, a second run deletes 0, other plugin rows stay; after a restart the 4 rows are gone.
      EVIDENCE: HTTP suite 37/37 pass. Host on port 1401: "legacy rows 4" before restart, "legacy rows after 0" and the settings row kept ("all plugin rows after 1").
- [x] L2b: The cleanup is safe when several processes boot at once on PostgreSQL.
      CHECK: own database `fin_sm_license` on PostgreSQL 16.15 (127.0.0.1:5440); one boot to create the schema, 5 legacy rows seeded (duplicates of `licenseKey` and `deviceId`), then 4 `strapi start` processes started at the same moment (ports 1403 to 1406).
      EXPECT: all 4 healthy, no error in the logs, 0 legacy rows, no duplicate plugin store rows.
      EVIDENCE: `/_health` 204 on all four; no error line; "legacy rows after 4 parallel boots 0"; the only plugin store row left is `contentApiPermissionsVersion` (one row).
- [x] L3: The five removed admin routes are not served.
      CHECK: same HTTP test, plus an admin-JWT `fetch('/magic-sessionmanager/license/status')` from the browser on port 1401.
      EXPECT: 404 or 405 in the test; 404 in the browser.
      EVIDENCE: test passes; browser returned 404.
- [x] L4: No outbound request from the plugin at boot or in the admin.
      CHECK: host log `grep -i "egress blocked"` with `block-egress.cjs` preloaded; Playwright aborts every non-loopback browser request and lists them.
      EXPECT: no egress attempt from the server; browser aborts only Strapi core requests.
      EVIDENCE: no "egress blocked" line in either boot log; the only aborted browser request was `api.github.com/repos/strapi/strapi/releases/` (Strapi core update check).

## Admin in the browser (isolated host, port 1401, packed tarball)

- [x] B1: Settings › Session Manager lists exactly Configuration and Analytics, on desktop and on the 390 px settings menu.
      EVIDENCE: Playwright: `settingsLinks` = Configuration (`/general`), Analytics (`/analytics`); `mobileSettingsLinks` = Configuration, Analytics; no "License" text in the settings navigation.
- [x] B2: The old bookmark `/admin/settings/magic-sessionmanager/license` behaves like any unknown settings route.
      EVIDENCE: empty content area with the settings navigation, identical to `/admin/settings/no-such-plugin/page` (both: no `main` element). Documented in README and CHANGELOG migration.
- [x] B3: No horizontal overflow on the plugin pages.
      EVIDENCE: dashboard, Configuration, Analytics and the homepage at 1440, 1024, 390 and 320 px, light and dark: `scrollWidth - innerWidth` = 0 in all 32 cases.
- [x] B4: Console attribution.
      EVIDENCE: warnings "useRBAC: The first argument should be an array" and the React Router future-flag warning also appear on native pages (`/admin/settings/webhooks`, `/admin/content-manager`, the login page); the plugin passes an array (`admin/src/permissions.js`). `net::ERR_FAILED` entries are the aborted Strapi update check.

## Installs (fresh Strapi 5.61 app, create-strapi-app 5.61.0 dependency list, SQLite)

Before = published 4.10.0 tarball, after = this branch packed. For Yarn and pnpm the after tarball was repacked with only the version changed, because Yarn's cache keys local tarballs by name and version and otherwise reused the 4.10.0 manifest. Pitfall: the first repack was made with macOS `tar` and carried `com.apple.provenance` extended attributes, which made Yarn 1 spin at 100 % CPU in "Resolving packages" (also in a fresh app). Repacked with `COPYFILE_DISABLE=1`, the same manifest installs in 10 s. `npm pack` output has no such headers.

| Package manager | Plugin warnings before                                                            | Plugin warnings after | Notes                                                                                                                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm 11.21.2     | 0                                                                                 | 0                     | npm installs missing peers itself; `npm ls` shows one `react-dom`, `styled-components`, `react-router-dom` and `@strapi/design-system` (deduped).                                                                                        |
| Yarn 1.22.22    | 4 (`@strapi/design-system`, `@strapi/icons`, `@strapi/utils`, `react-intl` unmet) | 0                     | Add into the existing app: the other 15 warnings are identical before and after and come from Strapi's own packages. A fresh install of the app with the plugin in `package.json` (205 s): 12 unmet-peer warnings, none from the plugin. |
| pnpm 12.18.0    | 0                                                                                 | 0                     | `pnpm peers check`: one issue, `codemirror` wanted by `@uiw/react-codemirror` (Strapi core). Optional peers are linked into the plugin; `strapi build` of the admin passes and includes the plugin.                                      |

- [x] Y1: Yarn 1 honours the optional peers.
      EVIDENCE: variant runs in the Yarn app: old manifest 4 plugin warnings; only `peerDependenciesMeta` added 1 (`@strapi/utils`); plus `@strapi/utils` as dependency 0; full new manifest 0. In an empty project Yarn warns only about the required peers, not the optional ones.

## Gates on the tree

- [x] G1: `npm run lint`, `npm run format:check`, `npm run test:ts:front`, `npm run test:ts:back` exit 0.
- [x] G2: `npm test` 739/739 pass (includes the isolated Strapi 5.61 HTTP suite).
- [x] G3: `npm run build`, `npm run verify`, `npm run verify:runtime` exit 0.
- [x] G4: `npm pack --dry-run`: 44 files, 794,211 bytes packed, 2,550,083 unpacked; only `dist`, entry shims, the GeoIP scripts, README, LICENSE, CHANGELOG and `pics`. No file name matches `.env|secret|token|credential|.pem|.key|auth|src/`.
- [x] G5: `npm pkg fix` leaves `package.json` unchanged; `npm publish --dry-run` prints no normalization warning (it stops only because 4.10.0 exists, which semantic-release bumps).
- [x] G6: CHANGELOG has one `[Unreleased]` above the newest release (`CHANGELOG_OK`).
- [x] G7: Pages: workbench `check-plugin-pages.mjs` reports "valid" on a copy; `site.css` is byte-identical to `templates/plugin-pages/site.css`; 320, 390, 1024 and 1440 px in light and dark: document overflow 0, no broken image, first Tab reaches the skip link, smooth scrolling off with reduced motion, no console error.
- [x] G8: Links in README and the site: 126 checked, 18 external; all resolve except `www.npmjs.com/package/...`, which answers 403 to scripted clients (Cloudflare); the registry entry answers 200.
