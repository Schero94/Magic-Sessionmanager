# UI redesign branch gates

Branch: `claude/sessionmanager-ui-redesign` (worktree `.tmp/sessionmanager-ui-redesign`, base `596d4b0` = 4.8.0 + acceptance work, design commit `b21c097`).
Design: `docs/plans/2026-11-06-ui-redesign-design.md`, overridden where they differ by the approved information architecture `docs/plans/2026-11-06-ui-information-architecture.md` (gate IA below). Findings: `docs/audits/2026-11-06-ui-acceptance-review.md`.
Parent gates: `GATES.md` N1–N6. 4.8.0 was released before acceptance; this branch carries the fixes for the next release (see `GATES.md`, "Release status").

Rules for this file:

- A gate is checked only when its CHECK passes on the current tree **and** the CHECK actually proves the claim. Source-contract tests (text checks on `.jsx`) and pure-helper unit tests prove structure and logic, not rendering. Every visual, keyboard and layout claim needs the browser gates B1–B4.
- Every count names the date, the tree and the Strapi version of the host dependencies.
- All test commands run from the worktree root with `SESSION_HTTP_STRAPI_NODE_MODULES="<workbench>/.tmp/sessionmanager-complete-host/node_modules"` (`@strapi/strapi` 5.61.0). Without it, the HTTP tests fall back to the workbench 5.58.0 test-app.
- Snapshot evidence below was taken on 2026-11-06 between ~17:35 and ~17:45 while other agents were still editing (the i18n merge was in progress). Z1 repeats everything on the final tree.

## Release block (GA-03, R4) — read before any release

- **4.8.0 is not accepted.** It was tagged and released (`c9ba929 chore(release): 4.8.0`) before this acceptance, although its own release-readiness audit said "Do not publish". The known defects of the released build are listed in `GATES.md` "Release status". Nothing in this file is evidence for 4.8.0.
- **The next release (4.9.0 or 5.0.0, see V2) must not be cut until all of the following are checked on the release commit:** `GATES.md` N1–N6; in this file IA, F2, V2, I2, Y2, B0–B4, R1, R2 and Z1; `gates/complete-acceptance-api.md` A2 and A3; `gates/complete-acceptance-ui.md` U2–U4; `gates/complete-acceptance-privacy.md` open handoff gates (consent/legal-basis decision for `geolocation=auto`); `gates/complete-acceptance-integration.md` open I-gates.
- The release workflow (`.github/workflows`, semantic-release on `main`) does **not** check these gates. Until it does, the release is blocked by this manual checklist: the owner signs it below with the release commit and date, after re-reading every listed gate. An unsigned checklist means "do not release".

  Release commit: ________  Date: ________  Owner sign-off: ________

## Acceptance evidence (GA-16)

Browser acceptance on the isolated Strapi 5.61.0 review host (`http://127.0.0.1:1351`, synthetic users `*.example.test`, IPs `203.0.113.x`, outbound network blocked), desktop first and then mobile. Each pass fixed what it found and was committed:

| Pass | Screens | Commit |
| --- | --- | --- |
| Desktop | Sessions dashboard, detail dialog | `7dabcf5` fix(admin): sessions dashboard desktop acceptance |
| Desktop | Configuration (five tabs) | `297a663` fix(admin): configuration desktop acceptance |
| Desktop | Analytics, License | `34a550a` fix(admin): analytics and license desktop acceptance |
| Desktop | Home widget, Content Manager user panel | `14d942f` fix(admin): widget and user panel desktop acceptance |
| Mobile | Sessions dashboard | `0d06e6d` fix(admin): sessions dashboard mobile acceptance |
| Mobile | Configuration | `3a67244` fix(admin): configuration mobile acceptance |
| Mobile | Analytics, License | `ef901b2` fix(admin): analytics and license mobile acceptance |
| Mobile | Home widget, user panel | `4b8d7b4` fix(admin): widget and user panel mobile acceptance |

The per-pass measurements (widths, screenshots, console) were taken by the pass owners and are not repeated here; this file only records that the passes ran and which commit carries each result. They do not close B1–B4: keyboard/screen-reader walks across five locales, dark mode contrast, the full state matrix and the B4 block round-trip were not part of every pass.

Follow-up on the final tree (`449564c`, rebuilt with the review host's `rebuild.sh`, 2026-11-06 ~21:25), measured by the closing agent in Playwright:

- User panel "Show all sessions": 113×32 px at 1440 px and 127×32 px at 390 px (was 214×20); `href` is `/admin/plugins/magic-sessionmanager?search=<email>` as IA C/D3 specifies (was `?_q=`); the dashboard opens with the search field prefilled and 8 rows for the synthetic user.
- Document title: panel page "anna.beispiel | Strapi" → after the link "Sessions | Strapi" (was unchanged). `PageShell` now renders `Page.Title`; Configuration shows "Session Manager configuration | Strapi", Analytics "Analytics | Strapi".
- Console: the "useRBAC: The first argument should be an array of permissions" warning comes from the host, not the plugin. The plugin's only `useRBAC` call (`SessionInfoPanel.jsx`) passes the array `pluginPermissions.access`; the object form is passed by Strapi's Content Manager (`@strapi/content-manager/dist/admin/features/DocumentRBAC.mjs`, `useRBAC(contentTypePermissions, …)`) and the warning also appears on Content Manager pages without the panel. Remaining errors on those pages are host requests (favicon 500, `api.github.com` blocked, i18n AI-localization and preview 404).
- SET-17 after the change: Configuration tab labels `text-transform: none`, `white-space: nowrap`, no flex grow; the Advanced trigger shows a 2 px solid outline on keyboard focus; the persistent load-error notice renders with the DS danger tone, `role="alert"`, its "Try again" action and no close button; the relaxed-mode warning is the unmodified DS Alert (its close button is the DS default 16×16 px, isolated in the alert's corner, so the WCAG 2.5.8 spacing exception applies).
- Widget at 320 px: tile frame 236 px, grid 237 px (the intended 1 px border overlap, clipped), each tile 118 px with `scrollWidth == clientWidth`, document overflow 0.

## Foundation (shared blocks in `admin/src/components/ui/`)

- [x] F1: `PageShell`, `SectionCard`, `StatGrid`/`StatCard`, `PropertyList`, `StatusBadge`, `ConfirmAction`, `DeviceIcon` and `MissingValue` exist and meet their source contracts and helper unit tests.
  CHECK: node --test tests/admin-ui-foundation.test.mjs tests/admin-ui-helpers.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:45, redesign working tree: 21 tests, 21 pass, 0 todo. Source-level only.
- [ ] F2: `StatCard` pairs label and value as `dl`/`dt`/`dd`, so screen readers read the label with the value (DUX-20, rest).
  EVIDENCE: open. The dashboard agent fixed tones, icons and reading order; the `dl` pairing is in `StatGrid.jsx`, which the foundation owner has to change.

## Information architecture (round 2)

The approved IA (`docs/plans/2026-11-06-ui-information-architecture.md`, decisions I.3 taken 2026-11-06) is the source of truth for labels, states, navigation, actions and copy. The screen gates below were checked against the round-1 design and do not prove the IA.

- [ ] IA: Every I.1 item (1–29) and every I.3 decision is implemented on the final tree: Active / Idle / Ended badges with an end-reason line and no danger colour for session states (I.1-1, I.1-2); settings links Configuration / Analytics / License and the five Configuration tabs with `?tab=` deep links (I.1-3, I.1-16); dashboard title, header links, stat-card lines, status and End reason filters, device text without version, View details / End session / More actions › Delete record with both delete confirmations, Signed in column, truncation alert, "How sessions work" disclosure, caption and "Last updated" (I.1-4 to I.1-11); dialog state sentence, Ended at, End reason, score note and on-demand "Look up location" (I.1-12 to I.1-15, I.2-7); Discard changes, Delete ended sessions, country-rule wording, load-failure and adjusted-values feedback, read-only rejection cards, Discord/Slack-only webhook inputs, 30-second footer (I.1-17 to I.1-23); Analytics KPIs and descriptions (I.1-24 to I.1-26); widget tiles with `isTrulyActive` (I.1-27, I.2-2); user panel wording and actions (I.1-28); A.1 retirements in all five locales with orphan keys removed (I.1-29); "Reason not recorded" for rows without a reason (I.2-1); stored-`deviceType` analytics buckets (I.2-3); additive "End reason" export column (I.2-4); "Open user" link only if session rows carry the user's `documentId` (I.2-6). README and CHANGELOG use the A glossary.
  CHECK: node --test tests/*.test.js tests/*.test.mjs && node --test tests/admin-symmetry-contract.test.mjs
  EXPECT: # fail 0 and # todo 0 in both runs, plus a written walk of section I.1 against the final source (each item with the file that implements it) and the browser gates B1–B3 for the visible copy
  EVIDENCE: open. README and CHANGELOG [Unreleased] were aligned to the glossary on 2026-11-06; the screens are being changed by the screen owners in round 2. Observed on the round-1 build and to be rechecked: ended sessions by inactivity shown as a red "TERMINATED" badge, duplicated browser versions ("Safari 17.4 17"), "Browser and OS unavailable" on sessions with a user agent, stat cards taller than their content, the dashboard search collapsed to an icon button, uppercase settings tab labels.

## Screens: source contracts

Each screen gate covers its source-contract and unit tests only. Rendering, equal heights, focus and overflow are B1–B3.

- [x] D1: Dashboard (`pages/HomePage.jsx`, `pages/Dashboard/*`): `PageShell`, Export menu in the header, `SearchInput` plus status select plus refresh, four-card `StatGrid`, DS table without min-width, row actions in an `IconButtonGroup` with `ConfirmAction`, card list below the large breakpoint, URL query state, native pagination, refresh without unmount, focus target after mutations.
  CHECK: node --test tests/dashboard-model.test.mjs tests/session-security.test.mjs tests/admin-dashboard-actions.test.mjs tests/session-exports.test.mjs tests/session-filtering.test.mjs tests/session-pagination.test.mjs tests/admin-session-display.test.mjs tests/admin-load-state-regression.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:45: 47 tests, 47 pass. The DASH-01 keyboard workaround (`shouldIsolateActionKey`) is unit-tested; the real keyboard walk through the DS grid table is not (B3).
- [x] D2: Session detail modal: `Modal.Title` with device icon and `StatusBadge`, five `PropertyList` sections, session-ID copy through `useClipboard`, translated VPN/proxy/risk badges, Close left and "Log out session" through `ConfirmAction` right, disabled with an explanation for ended sessions, focus return.
  CHECK: node --test tests/admin-modal-layout.test.mjs tests/admin-modal-focus.test.mjs tests/admin-modal-accessible-name.test.mjs tests/admin-clipboard.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:45: 13 tests, 13 pass.
- [x] S1: Settings (`pages/Settings/*`): split into tab files plus `useSettingsForm`, DS `Tabs`, header Save/Reset, inline validation, server round-trip after save, quoted "Copy for .env", hidden generated key, country `Combobox` and chips, email templates without emoji or editor colours, Danger zone through `ConfirmAction`, GeoIP privacy disclosure next to the geolocation switch.
  CHECK: node --test tests/admin-settings-checkbox.test.mjs tests/admin-settings-load-failure.test.mjs tests/admin-settings-number-input.test.mjs tests/admin-settings-responsive.test.mjs tests/admin-settings-tabs.test.mjs tests/admin-settings-textarea-accessibility.test.mjs tests/settings-form.test.mjs tests/settings-equality.test.mjs tests/admin-country-accessibility.test.mjs tests/admin-email-template-draft.test.mjs tests/admin-geoip-privacy-hint.test.mjs tests/admin-retention-locale.test.mjs tests/geofencing-mode.test.mjs tests/admin-textarea-focus.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:45: 52 tests, 52 pass. The `Blocker` (unsaved-changes guard) and the save round-trip still need a browser check (B1).
- [x] A1: Analytics: `StatGrid` KPIs, equal-height device and browser cards, readable bar labels.
  CHECK: node --test tests/admin-analytics-grid.test.mjs tests/session-analytics.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:45: 16 tests, 16 pass. Contrast in light and dark mode is a browser measurement (B1/B2).
- [x] L1: Activation/licence: status `SectionCard` with `PropertyList`, masked key with reveal and copy, refresh without unmount, retry state, no key in logs.
  CHECK: node --test tests/admin-activation-page.test.mjs tests/admin-activation-retry.test.mjs tests/activation-summary.test.mjs tests/admin-license-key-privacy.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:45: 17 tests, 17 pass.
- [x] W1: Home widget "Online users": 2×2 tiles, loading/error/empty states, permission-backed registration.
  CHECK: node --test tests/admin-online-widget.test.mjs tests/admin-widget-permissions.test.mjs tests/widget-stats.test.mjs tests/online-stats.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:45: 19 tests, 19 pass. Final tree `449564c` (~21:25): 19 tests, 19 pass, including the F10 regression "widget tiles cannot force a min-content width wider than a 320 px screen", which pins the whole min-content chain (shrinkable grid columns, `minWidth={0}` on every box down to the text, `overflow-wrap: anywhere`, no fixed width/nowrap/ellipsis in a tile, icons removed below 28rem). Browser at 320 px: no tile overflow (see "Acceptance evidence").
- [x] P1: User panel (Content Manager → User): summary, equal-height "Log out all" and "Block/Unblock" through `ConfirmAction`, form sync of `blocked` after block/unblock, nothing rendered for other models.
  CHECK: node --test tests/admin-user-panel.test.mjs tests/user-panel-state.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:45: 19 tests, 19 pass. That a later Save no longer reverts a block must be shown in a real Content Manager (B1).
- [x] X1: Cross-screen contracts (accessibility, destructive confirmations, native UI, layout, text rhythm, response envelopes, privacy logging, registration, localized alerts) pass on the final tree.
  CHECK: node --test tests/admin-accessibility.test.mjs tests/admin-destructive-confirmations.test.mjs tests/admin-native-ui.test.mjs tests/admin-layout-contract.test.mjs tests/admin-text-rhythm.test.mjs tests/admin-privacy-logging.test.mjs tests/admin-response-contract.test.mjs tests/admin-registration.test.mjs tests/admin-initializer.test.mjs tests/admin-alert-and-panel-localization.test.mjs tests/admin-animation-references.test.mjs
  EXPECT: # fail 0
  EVIDENCE: 2026-11-06 ~17:45: 50 tests, 49 pass, 1 fail while the i18n merge was being written. Final tree `449564c`, 2026-11-06 ~21:35: 50 tests, 50 pass, 0 todo. Source contracts only. SET-17 is additionally guarded by `tests/admin-ds-internals.test.mjs` (3 tests, 3 pass): no Radix data attributes, positional selectors, DS layout roles or label-span selectors in the styled blocks of `pages/Settings/*`, `PersistentAlert`, `ActionStack`, `FormField` and `SettingsToggleRow`, and `admin/src/utils/theme.js` (DUX-11, unused static palette) is deleted. Not covered by that guard and left as known residuals: `HomePage.jsx` `PaginationTargets` (`& > div > div > span` into the admin pagination) and the touch-target rules on DS controls (`[role='switch']`, `input[role='combobox']`, `& button` in the chip list, variable grid and search field).

## Server fixes

- [x] V1: Server regressions from the review have tests that pass: per-route 429 keyed on the route template (API-1/API-2), write limit can only be tightened (API-5), partial settings PUT keeps omitted fields and reports invalid ones (API-6), store/provider failures are 500/502/503 (API-7), `store-key` input checks (API-8), password reset ends older sessions (GA-04), foreign session delete answers like an absent one (API-10), block revokes once (API-12), bodyless toggle-block keeps the old toggle (GA-09/API-4), admin lists drop `sessionId` (F12).
  CHECK: node --test tests/server-api-hardening.test.js tests/auth-routes.test.js tests/settings.test.js tests/license-controller.test.js tests/geoip-controller.test.js tests/endpoint-error-contracts.test.js tests/route-contracts.test.js tests/content-api-permissions.test.js tests/session-controller-delete.test.js tests/native-session-routes.test.js tests/session-policy.test.js && SESSION_HTTP_MODE=legacy-support node --test tests/isolated-http-access.test.js && SESSION_HTTP_MODE=refresh SESSION_HTTP_FALLBACK=1 node --test tests/isolated-http-access.test.js
  EXPECT: # fail 0 in every run, # skipped 0
  EVIDENCE: 2026-11-06 ~17:40, Strapi 5.61.0 host dependencies: focused server 98/98; isolated HTTP legacy-support 38/38; refresh 40/40; refresh + fallback 41/41; legacy + fallback 39/39; `tests/isolated-fallback-logout-http.test.js` + `tests/isolated-http-portability.test.js` 5/5 (GA-01 portability). This proves the listed cases on one SQLite process. It is not a security sign-off; `gates/complete-acceptance-api.md` A2 stays open.
- [ ] V2: The client-visible changes are decided and documented for the release: 400 → 500/502/503 for server-side failures, `sessionId` removed from admin session lists, deprecated bodyless toggle. Decide the version number (minor vs. major) accordingly.
  EVIDENCE: open. Listed in `CHANGELOG.md` [Unreleased]. The final review (2026-11-06 ~22:15) compared `git diff c9ba929..HEAD -- server` with the changelog and added the client-visible changes that were missing: `nativeSessionId` dropped from session responses, 404 for unknown sessions or users on admin terminate and terminate-all, 500 with counts for a partial `clean-inactive`, field errors instead of silent emptying or truncation for webhook URLs and email templates, the stricter `session-required` policy in Strict mode, geolocation turned off when the settings store cannot be read, iPad/iOS detection, and IPv4-mapped IPv6 private-range detection. The README toggle-block section was corrected on 2026-11-06: explicit `{ "blocked": true | false }` is recommended, a bodyless request still toggles (deprecated), a non-boolean `blocked` is 400, and the response adds `mode`. The version decision is still open.

## i18n

- [x] I1: Every `formatMessage` id used in `admin/src` exists in en, de, fr, es and pt; `defaultMessage` equals the English value; German uses "Sie" and "Sitzung"; obsolete keys are removed. All locale tests run strict (no todo).
  CHECK: node --test tests/dashboard-i18n.test.mjs tests/admin-analytics-license-i18n.test.mjs tests/admin-widget-panel-i18n.test.mjs tests/admin-settings-locales.test.mjs tests/admin-ui-foundation.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:45, merge in progress: 35 tests, 29 pass, 1 fail, 5 todo. Final tree `449564c`, ~21:35: 37 tests, 37 pass, 0 todo (strict). Widget and panel (UX-17): `tests/admin-widget-panel-i18n.test.mjs` 4/4 — the scan finds the panel, widget and registration messages; every message exists in en, de, fr, es, pt; `defaultMessage` equals the English catalogue; German uses "sperren", "Sitzung" and "Sie". Rendered locale review is I2.
- [ ] I2: Locale review in the browser: every screen in all five locales with no English fallback text, no truncated labels, translated dates through the admin locale.
  EVIDENCE: open (browser).

## Symmetry

- [x] Y1: Source symmetry contract runs strict: no `window.confirm`, no emoji in JSX, no hex/rgb colours, no px font sizes, no px spacing in style props, no custom `@media` widths.
  CHECK: node --test tests/admin-symmetry-contract.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:40: 7 tests, 1 pass, 6 todo. Final tree `449564c`, ~21:35: 7 tests, 7 pass, 0 todo (strict).
- [ ] Y2: Measured in the browser for every screen at 1440, 1080, 1024, 768, 520, 390 and 320 px: height difference of siblings in one grid row = 0 px; gaps between siblings in {4, 8, 12, 16, 24, 32} px; left edges of section cards equal the page title's; no horizontal document overflow.
  EVIDENCE: open. Nothing measured on the redesigned build yet.

## Browser matrix (isolated host, synthetic data, Strapi 5.61)

Desktop first, then mobile. Light and dark mode. Each run records widths, screenshots, console and the exact build.

- [ ] B0: Plugin build, verify, verify:runtime and the shared host admin build pass on the final tree; the host boots on a fresh SQLite database with outbound network blocked.
  CHECK: npm run build && npm run verify && npm run verify:runtime
  EXPECT: exit 0
  EVIDENCE: Clean install (GA-17), 2026-11-06 ~21:30: `git archive 449564c` extracted into an empty scratch directory (`…/scratchpad/sm-clean`), Node v22.23.1, npm 10.9.8, `SESSION_HTTP_STRAPI_NODE_MODULES` on the Strapi 5.61.0 host. `npm ci --no-audit --no-fund` exit 0 (1910 packages, 20 s; deprecation warnings only for rimraf 3, glob 7, @koa/router 12); `npm test` exit 0 — 749 tests, 749 pass, 0 fail, 0 skipped, 0 todo; `test:ts:front` 0; `test:ts:back` 0; `npm run build` exit 0 (vite 6.4.4, 92 admin modules, server bundle `dist/server/index.mjs` 465.8 kB); `npm run verify` exit 0 (package.json and exports verified); `npm run verify:runtime` exit 0 ("Server bundle runtime check passed"); `npm pack --dry-run` exit 0 (`strapi-plugin-magic-sessionmanager-4.8.0.tgz`, 44 files, 2.9 MB packed, 5.0 MB unpacked). The isolated review host on 1351 rebuilt its admin with this plugin build and booted with outbound requests blocked (`rebuild.sh`), but on its existing synthetic SQLite database, not a fresh one; the shared eight-plugin host was not built. Final review, 2026-11-06 ~22:15, in the worktree on `7af2b52` code (the review commit changes documentation only), Node v22.23.1: `npm run build` exit 0 (server bundle `dist/server/index.mjs` 487.8 kB), `npm run verify` exit 0, `npm run verify:runtime` exit 0 ("Server bundle runtime check passed"), `npm pack --dry-run` exit 0 (version 4.8.0, 48 files, 765.6 kB packed, 2.5 MB unpacked; the 4 extra files are the new screenshots in `pics/`). Stays open until the fresh-database boot and the shared host build are recorded.
- [ ] B1: Desktop 1440, 1080 and 1024 px: every screen (dashboard, modal, Settings tabs, Analytics, Activation, widget, user panel) and every state (loading, empty, no results, error/retry, success, confirmation cancel/confirm, unsaved-changes blocker); 0 plugin console errors.
  EVIDENCE: open.
- [ ] B2: Mobile 768, 520, 390 and 320 px: same screens and states; dashboard card list; touch targets ≥ 32 px; widget without overflow at 320 px.
  EVIDENCE: open.
- [ ] B3: Keyboard and screen reader: full keyboard walk with visible focus on every screen (including the DASH-01 row actions in the DS grid table), focus return after every dialog, refresh, delete and pagination; dialog names in all five locales; contrast ≥ 4.5:1 in light and dark.
  EVIDENCE: open.
- [ ] B4: Block/unblock from the user panel: the request carries `{ blocked }`, the open Content Manager form updates, and a later Save does not unblock the user.
  EVIDENCE: open.

## Documentation

- [ ] R1: New README screenshots in `pics/` from the same synthetic data, for every screen, desktop and mobile; README text matches the redesigned UI and the server contract (including the toggle-block line).
  EVIDENCE: open. Text part done on 2026-11-06 (not yet checked against the final UI): README uses the IA glossary (End / Delete record / Block, Configuration / Analytics / License, five Configuration tabs, login protection on new sign-ins only, IP lockout instead of account block, settings reach other processes within 30 s, Discord and Slack webhooks only) and the restored toggle-block contract; `node --test tests/readme-geoip-privacy.test.mjs tests/admin-session-display.test.mjs` passes. Screenshots in `pics/` are still from the old UI.
  Update 2026-11-06 ~22:15 (final review): `e37219a` replaced the screenshots and `7af2b52` rewrote the README. Ten images from the same synthetic data: dashboard (light and dark), details dialog, user panel, widget, Configuration Sessions and Login protection tabs, Analytics, and on mobile (390 px) the dashboard card list and the details dialog. Each image was opened and checked: only `*.example.test` users, `203.0.113.x` addresses and the "RA" avatar, with no tokens, keys, local paths or browser chrome. The README claims were checked against the code: routes and policies (`server/src/routes/*.js`), defaults (`server/src/config/index.js`, `controllers/settings.js` `DEFAULT_SETTINGS`), admin ranges (`INTEGER_SETTING_RANGES`, retention -1/1–365), email template limits, webhook hosts, env vars (`SESSION_ENCRYPTION_KEY`, GeoIP path variables, MaxMind env taking precedence in `controllers/geoip.js`), retention timer (first run about 24 h after start), 30 s settings cache, 15-minute lockout, score thresholds 70 and 50, the 50-session new-country window, the widget refresh (30 s) and the dashboard refresh (10 min), `engines.node` and peer ranges. No wrong claim was found. `node --test tests/readme-geoip-privacy.test.mjs tests/admin-session-display.test.mjs tests/readme-session-policy.test.mjs`: 10/10. Still open: there is no screenshot of the License page or of the Location data, Alerts and Data and retention tabs, and on mobile only the dashboard and dialog are shown, so "every screen, desktop and mobile" is not met.
- [ ] R2: The GitHub Page gallery uses the new screenshots and passes `node scripts/check-plugin-pages.mjs Magic-Sessionmanager` in the workbench for this version.
  EVIDENCE: open. The root workbench gate `gates/pages-sessionmanager.md` still points at `plugins/Magic-Sessionmanager` `2f00880` (4.7.2).
  Update 2026-11-06 ~22:15 (final review): the gallery in `docs/site/index.html` uses the 10 new `docs/site/img/*.webp` files. Decoded with sharp, each one is pixel-identical to its `pics/*.png` (0 differing bytes, same dimensions), and none has EXIF or XMP metadata. Every local `src`/`href` in the page resolves. `docs/site/site.css` is byte-identical to the workbench `templates/plugin-pages/site.css`. The workbench checker, byte-identical to `scripts/check-plugin-pages.mjs`, was run from a scratch copy whose `plugins/Magic-Sessionmanager` links to this worktree: `node scripts/check-plugin-pages.mjs Magic-Sessionmanager` printed "Magic-Sessionmanager: valid" (exit 0), and `sync-plugin-page-theme.mjs --check` printed "Magic-Sessionmanager: shared theme current". The unscoped runs exit 1 only because the other seven plugins are missing from the scratch copy. Stays open because the CHECK has to run in the workbench itself, which still checks out `2f00880`. That can happen only after this branch is merged and the workbench checkout is updated.
- [x] R3: `CHANGELOG.md` has one `[Unreleased]` section at the top describing this branch, and the stale `[Unreleased]` block below 4.8.0 is gone (GA-13).
  CHECK: node -e "const s=require('fs').readFileSync('CHANGELOG.md','utf8');const i=s.indexOf('## [Unreleased]');const n=(s.match(/## \[Unreleased\]/g)||[]).length;process.exit(n===1&&i>=0&&i<s.indexOf('# [4.8.0]')?0:1)" && echo CHANGELOG_OK
  EXPECT: CHANGELOG_OK
  EVIDENCE: 2026-11-06: CHANGELOG_OK. Re-run in the final review (~22:15) after the [Unreleased] additions: CHANGELOG_OK.
- [ ] R4: A release cannot be cut while `GATES.md` N-gates or this file's B-gates are open (GA-03): either a check in the release workflow or a documented manual release checklist that the owner signs.
  EVIDENCE: 2026-11-06: the manual release block with the gate list and an owner sign-off line is in place at the top of this file ("Release block"); `GATES.md` "Release status" points to it. Stays open: the release workflow still does not check the gates, and the checklist has not been signed. Note from the final review: `2c097be` adds `.github/workflows/dependency-auto-merge.yml`, which squash-merges non-major Dependabot pull requests into the default branch without checking these gates. Because the merges use `GITHUB_TOKEN`, they do not start `release.yml`, but the next human push to `main` releases everything merged since the last release. `.github/workflows/test.yml` still tests Node 20.x, which is outside `engines.node` (`^22.22.2 || >=24.15.0`).

## Final

- [ ] Z1: On the final combined tree: full suite `node --test tests/*.test.js tests/*.test.mjs` with 0 fail and 0 todo, both type checks, all gates above re-run and their evidence updated, no credentials or real user data in artifacts.
  CHECK: node --test tests/*.test.js tests/*.test.mjs && npm run -s test:ts:front && npm run -s test:ts:back
  EXPECT: # fail 0, # todo 0, exit 0
  EVIDENCE: snapshot, 2026-11-06 ~17:35: 627 tests, 609 pass, 0 fail, 18 todo. Final tree `449564c` (and again in the clean install, see B0), Strapi 5.61.0 host dependencies: 749 tests, 749 pass, 0 fail, 0 skipped, 0 todo; `test:ts:front` and `test:ts:back` exit 0. Open: not every gate above is closed (IA, F2, V2, I2, Y2, B0–B4, R1, R2, R4).
  Final review, 2026-11-06 ~22:15, worktree on `7af2b52` code, Strapi 5.61.0 host dependencies: `npm test` exit 0, with 749 tests, 749 pass, 0 fail, 0 skipped, 0 todo. `test:ts:front` and `test:ts:back` exit 0, and build, verify, verify:runtime and pack all pass (see B0). Artifact scan of the tracked files: no tokens, JWTs (only fake test fixtures), npm/GitHub/AWS keys, real webhook URLs or private keys. The only email addresses are `example.test`/`example.invalid` addresses and version strings. Public IPs appear only in tests and UA fixtures (`8.8.8.8`, `1.1.1.1`, `9.9.9.9`, Chrome version numbers), and the docs use only documentation and private ranges. Absolute local paths in `docs/audits/2026-11-06-ui-acceptance-review.md` and in this file were replaced with `<scratchpad>`/`<workbench>`. The older `gates/native-*.md` files, which were already on `main` before this branch, still contain `/Users/…` paths to a local skill script.
