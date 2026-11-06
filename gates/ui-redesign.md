# UI redesign branch gates

Branch: `claude/sessionmanager-ui-redesign` (worktree `.tmp/sessionmanager-ui-redesign`, base `596d4b0` = 4.8.0 + acceptance work, design commit `b21c097`).
Design: `docs/plans/2026-11-06-ui-redesign-design.md`, overridden where they differ by the approved information architecture `docs/plans/2026-11-06-ui-information-architecture.md` (gate IA below). Findings: `docs/audits/2026-11-06-ui-acceptance-review.md`.
Parent gates: `GATES.md` N1–N6. 4.8.0 was released before acceptance; this branch carries the fixes for the next release (see `GATES.md`, "Release status").

Rules for this file:

- A gate is checked only when its CHECK passes on the current tree **and** the CHECK actually proves the claim. Source-contract tests (text checks on `.jsx`) and pure-helper unit tests prove structure and logic, not rendering. Every visual, keyboard and layout claim needs the browser gates B1–B4.
- Every count names the date, the tree and the Strapi version of the host dependencies.
- All test commands run from the worktree root with `SESSION_HTTP_STRAPI_NODE_MODULES="/Volumes/Crucial X10/Privat.nosync/Strapi Plugins /.tmp/sessionmanager-complete-host/node_modules"` (`@strapi/strapi` 5.61.0). Without it, the HTTP tests fall back to the workbench 5.58.0 test-app.
- Snapshot evidence below was taken on 2026-11-06 between ~17:35 and ~17:45 while other agents were still editing (the i18n merge was in progress). Z1 repeats everything on the final tree.

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
  EVIDENCE: 2026-11-06 ~17:45: 19 tests, 19 pass. "No overflow at 320 px" is B2.
- [x] P1: User panel (Content Manager → User): summary, equal-height "Log out all" and "Block/Unblock" through `ConfirmAction`, form sync of `blocked` after block/unblock, nothing rendered for other models.
  CHECK: node --test tests/admin-user-panel.test.mjs tests/user-panel-state.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:45: 19 tests, 19 pass. That a later Save no longer reverts a block must be shown in a real Content Manager (B1).
- [ ] X1: Cross-screen contracts (accessibility, destructive confirmations, native UI, layout, text rhythm, response envelopes, privacy logging, registration, localized alerts) pass on the final tree.
  CHECK: node --test tests/admin-accessibility.test.mjs tests/admin-destructive-confirmations.test.mjs tests/admin-native-ui.test.mjs tests/admin-layout-contract.test.mjs tests/admin-text-rhythm.test.mjs tests/admin-privacy-logging.test.mjs tests/admin-response-contract.test.mjs tests/admin-registration.test.mjs tests/admin-initializer.test.mjs tests/admin-alert-and-panel-localization.test.mjs tests/admin-animation-references.test.mjs
  EXPECT: # fail 0
  EVIDENCE: 2026-11-06 ~17:45: 50 tests, 49 pass, 1 fail ("analytics and activation labels are present in every supported locale") while the i18n merge was being written. Re-run after I1.

## Server fixes

- [x] V1: Server regressions from the review have tests that pass: per-route 429 keyed on the route template (API-1/API-2), write limit can only be tightened (API-5), partial settings PUT keeps omitted fields and reports invalid ones (API-6), store/provider failures are 500/502/503 (API-7), `store-key` input checks (API-8), password reset ends older sessions (GA-04), foreign session delete answers like an absent one (API-10), block revokes once (API-12), bodyless toggle-block keeps the old toggle (GA-09/API-4), admin lists drop `sessionId` (F12).
  CHECK: node --test tests/server-api-hardening.test.js tests/auth-routes.test.js tests/settings.test.js tests/license-controller.test.js tests/geoip-controller.test.js tests/endpoint-error-contracts.test.js tests/route-contracts.test.js tests/content-api-permissions.test.js tests/session-controller-delete.test.js tests/native-session-routes.test.js tests/session-policy.test.js && SESSION_HTTP_MODE=legacy-support node --test tests/isolated-http-access.test.js && SESSION_HTTP_MODE=refresh SESSION_HTTP_FALLBACK=1 node --test tests/isolated-http-access.test.js
  EXPECT: # fail 0 in every run, # skipped 0
  EVIDENCE: 2026-11-06 ~17:40, Strapi 5.61.0 host dependencies: focused server 98/98; isolated HTTP legacy-support 38/38; refresh 40/40; refresh + fallback 41/41; legacy + fallback 39/39; `tests/isolated-fallback-logout-http.test.js` + `tests/isolated-http-portability.test.js` 5/5 (GA-01 portability). This proves the listed cases on one SQLite process. It is not a security sign-off; `gates/complete-acceptance-api.md` A2 stays open.
- [ ] V2: The client-visible changes are decided and documented for the release: 400 → 500/502/503 for server-side failures, `sessionId` removed from admin session lists, deprecated bodyless toggle. Decide the version number (minor vs. major) accordingly.
  EVIDENCE: open. Listed in `CHANGELOG.md` [Unreleased]. The README toggle-block section was corrected on 2026-11-06: explicit `{ "blocked": true | false }` is recommended, a bodyless request still toggles (deprecated), a non-boolean `blocked` is 400, and the response adds `mode`. The version decision is still open.

## i18n

- [ ] I1: Every `formatMessage` id used in `admin/src` exists in en, de, fr, es and pt; `defaultMessage` equals the English value; German uses "Sie" and "Sitzung"; obsolete keys are removed. All locale tests run strict (no todo).
  CHECK: node --test tests/dashboard-i18n.test.mjs tests/admin-analytics-license-i18n.test.mjs tests/admin-widget-panel-i18n.test.mjs tests/admin-settings-locales.test.mjs tests/admin-ui-foundation.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:45, merge in progress: 35 tests, 29 pass, 1 fail, 5 todo. Open by design until the new keys are merged into the locale catalogues and the todo guards are flipped to strict.
- [ ] I2: Locale review in the browser: every screen in all five locales with no English fallback text, no truncated labels, translated dates through the admin locale.
  EVIDENCE: open (browser).

## Symmetry

- [ ] Y1: Source symmetry contract runs strict: no `window.confirm`, no emoji in JSX, no hex/rgb colours, no px font sizes, no px spacing in style props, no custom `@media` widths.
  CHECK: node --test tests/admin-symmetry-contract.test.mjs
  EXPECT: # fail 0 and # todo 0
  EVIDENCE: 2026-11-06 ~17:40: 7 tests, 1 pass, 6 todo. The six todo checks currently report no violations, but they are not enforced yet. Flip them to strict after all screens are migrated.
- [ ] Y2: Measured in the browser for every screen at 1440, 1080, 1024, 768, 520, 390 and 320 px: height difference of siblings in one grid row = 0 px; gaps between siblings in {4, 8, 12, 16, 24, 32} px; left edges of section cards equal the page title's; no horizontal document overflow.
  EVIDENCE: open. Nothing measured on the redesigned build yet.

## Browser matrix (isolated host, synthetic data, Strapi 5.61)

Desktop first, then mobile. Light and dark mode. Each run records widths, screenshots, console and the exact build.

- [ ] B0: Plugin build, verify, verify:runtime and the shared host admin build pass on the final tree; the host boots on a fresh SQLite database with outbound network blocked.
  CHECK: npm run build && npm run verify && npm run verify:runtime
  EXPECT: exit 0
  EVIDENCE: not run on this tree (builds were not allowed in this step).
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
- [ ] R2: The GitHub Page gallery uses the new screenshots and passes `node scripts/check-plugin-pages.mjs Magic-Sessionmanager` in the workbench for this version.
  EVIDENCE: open. The root workbench gate `gates/pages-sessionmanager.md` still points at `plugins/Magic-Sessionmanager` `2f00880` (4.7.2).
- [x] R3: `CHANGELOG.md` has one `[Unreleased]` section at the top describing this branch, and the stale `[Unreleased]` block below 4.8.0 is gone (GA-13).
  CHECK: node -e "const s=require('fs').readFileSync('CHANGELOG.md','utf8');const i=s.indexOf('## [Unreleased]');const n=(s.match(/## \[Unreleased\]/g)||[]).length;process.exit(n===1&&i>=0&&i<s.indexOf('# [4.8.0]')?0:1)" && echo CHANGELOG_OK
  EXPECT: CHANGELOG_OK
  EVIDENCE: 2026-11-06: CHANGELOG_OK.
- [ ] R4: A release cannot be cut while `GATES.md` N-gates or this file's B-gates are open (GA-03): either a check in the release workflow or a documented manual release checklist that the owner signs.
  EVIDENCE: open. 4.8.0 shows that the current workflow does not stop this.

## Final

- [ ] Z1: On the final combined tree: full suite `node --test tests/*.test.js tests/*.test.mjs` with 0 fail and 0 todo, both type checks, all gates above re-run and their evidence updated, no credentials or real user data in artifacts.
  CHECK: node --test tests/*.test.js tests/*.test.mjs && npm run -s test:ts:front && npm run -s test:ts:back
  EXPECT: # fail 0, # todo 0, exit 0
  EVIDENCE: snapshot only, 2026-11-06 ~17:35 on Strapi 5.61.0 host dependencies: 627 tests, 609 pass, 0 fail, 18 todo; `test:ts:front` and `test:ts:back` exit 0. Not final: other agents were still editing and the i18n merge was not done.
