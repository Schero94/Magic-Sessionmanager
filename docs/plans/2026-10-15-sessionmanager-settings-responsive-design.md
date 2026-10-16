# Magic Session Manager settings: responsive redesign

## Current state

- The existing route is `/admin/settings/magic-sessionmanager/general`. It must remain stable.
- `admin/src/index.js` uses Strapi's deprecated `app.createSettingSection` API. Strapi 5.58.0 still supports it as a wrapper around `addSettingsLink`, but current Strapi 5 documentation recommends the latter. The section also carries an unnecessary `to` property.
- The Settings links and main plugin link are gated by `plugin::magic-sessionmanager.access`. Preserve that permission boundary; do not make the links public to compensate for discoverability.
- Eight settings switches are laid out in cards. Seven place the switch above centered copy; one geofencing switch is already side-by-side. This wastes vertical space and makes otherwise equal cards feel inconsistent.
- `ReadableText` and `FieldHint` set a max-width but not an explicit width/min-width. In centered flex columns they can shrink to intrinsic content size and produce awkward wrapping or overflow.
- The Settings surface contains general, security, geofencing, email, and webhook accordions. Existing form data, warning text, confirmation steps, and save/reset behavior must remain unchanged.
- Authenticated Playwright inspection is currently unavailable. The previous browser session is at Strapi login, so source/API evidence is not being treated as a visual acceptance pass.

## Target state

- Register the section with current `app.addSettingsLink({ id, intlLabel }, links)` API. Keep the section id, link ids, permissions, and final paths unchanged. Use the clear section label `Session Manager` in all supported locales.
- Give every setting switch the same compact horizontal row: descriptive title and text on one side, a horizontal switch aligned at the opposite edge. At narrow widths the copy wraps within the card while the control remains horizontal; do not put a switch in a separate vertical block above its description.
- Share this row component across all eight switches, including geofencing, to make alignment, focus, state, and spacing consistent.
- Give readable copy and field hints explicit `width: 100%` and `min-width: 0`, retaining a readable maximum measure. This prevents intrinsic text width from expanding or centering oddly inside a responsive column.
- Preserve the existing Strapi Design System components, field labels/descriptions, five locale values, field names, setting values, API calls, routes, permissions, and end-user-only session scope.

## Acceptance criteria

1. The Strapi settings section is registered through the current Settings API, displays `Session Manager`, and retains the route `/admin/settings/magic-sessionmanager/general` plus Analytics and Activation links.
2. All eight switches render through one accessible horizontal row component, with visible title, description, accessible name, and state labels. No Settings switch remains in a centered vertical toggle card.
3. At 320, 390, 1024, and 1440 CSS pixels, the Settings page and each toggle card have no unintended horizontal overflow. Long German copy wraps without clipping, and switch hit areas remain reachable.
4. All controls and descriptions keep their prior values and behavior. Permissions are unchanged. No settings are saved during UI acceptance.
5. Focused source-contract tests, plugin tests, frontend type check, plugin build/verify, shared app build/boot, and authenticated Playwright geometry checks are reported separately. Browser checks that cannot be authenticated remain explicitly open.

## Current documentation checked

- Strapi 5 Admin Panel API: https://docs.strapi.io/cms/plugins-development/admin-panel-api
- Strapi 5 navigation and settings API: https://docs.strapi.io/cms/plugins-development/admin-navigation-settings
- Strapi Design System responsive foundations: https://github.com/strapi/design-system/blob/main/docs/stories/01-foundations/responsive.mdx
- Strapi Design System grid foundations: https://github.com/strapi/design-system/blob/main/docs/stories/01-foundations/grid.mdx
- Installed host versions checked on 2026-10-15: Strapi 5.58.0 and `@strapi/design-system` 2.2.4.
- Context7 monthly quota is exhausted for this environment. The current official Strapi documentation and the installed Strapi 5.58.0 TypeScript/runtime implementation were checked instead.

## Implementation and verification record

- Implemented the navigation migration and shared horizontal setting-row component. All eight Settings switches now share the same accessible row, including Geofencing. Copy and field hints are shrink-safe and full-width within their columns.
- Added the root quality rule plus all eight plugin copies, and updated the workbench and Session Manager maintenance skills. Both the workbench and global Playwright skill now explicitly prohibit CUA/Computer Use and require Playwright CLI only.
- `npm test` in the workbench: 14 passed. `npm test` in the plugin: 285 passed. Frontend type check, plugin build, package verify, runtime verify, shared app build and `git diff --check` passed.
- Strapi 5.58.0 started with all eight workbench plugins loaded.
- Playwright CLI opened the exact Settings URL, then found the existing browser state had redirected to Strapi login. The prior local test password was exposed earlier in the work, so it was not reused. Authenticated toggle geometry, overflow, keyboard focus and screenshots remain unverified pending credential rotation and a new test login.
- No settings were saved. No end-user or admin sessions were changed. No provider call, external send, or destructive action was performed.

### 2026-10-16 continuation

- Playwright CLI only: reloaded the exact Settings route and confirmed Strapi redirects the browser to `/admin/auth/login` without authenticated state. The local test password had been exposed in earlier tool output, so it was not used again. No CUA or desktop-control tool was used for this continuation.
- Re-ran the workbench suite: 14 passed. Re-ran the plugin suite: 285 passed. Re-ran `npm run test:ts:front`: passed. The workbench rule/skill contract test also passes with the CLI-only requirement.
- Authenticated responsive geometry for the Settings page is still open. Rotate the exposed test password and provide a fresh local test credential/session before resuming this Playwright acceptance gate.

### 2026-10-16 visual re-audit

#### Current state

- The requested `127.0.0.1:1338` route redirects an unauthenticated browser to Strapi login. Its process and database were left untouched.
- A separate Strapi 5.58.0 host on port 1340 was started with a new temporary SQLite database and a synthetic local admin. Playwright CLI confirmed all eight workbench plugins loaded. No settings were saved.
- The source already places each setting's copy beside its control, but the shared row uses `@strapi/design-system`'s `Toggle`. In the installed Design System 2.2.4, that primitive renders the Off/On choices as a vertical 104-by-72-pixel control. At 320 CSS pixels, the setting rows grew to 198-466 pixels tall even though the page itself did not overflow.
- The security feature switches use a two-column layout for three items, leaving the last item alone. Several multi-sentence explanations are rendered as one dense paragraph.

#### Target state

- Use the installed Design System `Switch` primitive. Keep it horizontal, label it with the setting title, associate its description, and preserve controlled checked state without visible stacked Off/On labels.
- Keep repeated security switches in one consistent full-width list. Preserve equal columns for genuinely paired form fields and stack those fields at the responsive breakpoint.
- Render multi-idea policy, warning, switch-hint, and footer copy as separate readable paragraphs. Preserve existing wording where it is translated, and add localized enforcement text where those keys were missing.
- Keep all settings values, save/reset behavior, routes, permissions, and the Users & Permissions end-user-only session scope unchanged. Do not save settings during browser acceptance.

#### Updated acceptance checks

1. All eight settings switches use Strapi Design System `Switch`, expose role `switch`, have an accessible name and description, and no longer render stacked Off/On labels.
2. Repeated security switch rows use one consistent full-width layout. Paired form fields retain equal desktop columns, while an unpaired field uses the full row and stacked fields never clip.
3. At 320, 390, 519, 520, 767, 768, 1024, 1079, 1080, and 1440 CSS pixels, the Settings document has no horizontal overflow. Every switch remains horizontal and reachable, and row text wraps without excessive control-driven height.
4. Multi-sentence policy and footer explanations have visible paragraph separation. No settings values, API calls, permission rules, or session scope change.
5. Run the focused regression test before implementation, then the complete plugin tests, frontend/backend type checks, plugin build/verify, shared admin build, and authenticated Playwright CLI checks. Port 1338 remains untouched.

#### Documentation checked

- Context7's monthly quota was exhausted on 2026-10-16. The official [Strapi Design System v2 migration guide](https://docs.strapi.io/cms/migration/v4-to-v5/breaking-changes/design-system) and [responsive foundations](https://github.com/strapi/design-system/blob/main/docs/stories/01-foundations/responsive.mdx) were checked with web fetch.
- Installed Strapi Design System 2.2.4 types confirm that `Switch` is backed by Radix Switch and accepts controlled `checked` plus `onCheckedChange`. Its installed implementation renders a 40-by-24-pixel horizontal track. The separate `Toggle` implementation has the vertical Off/On layout seen in the browser.
- The Design System Storybook Switch URL returned no page content. Exact component props and layout were therefore verified against the installed Design System 2.2.4 declarations and runtime bundle.

#### Implementation and verification result

- All eight settings now use one shared row backed by Strapi Design System Switch. The control has a 40-by-24-pixel track, a visible keyboard focus outline, a controlled checked state, an accessible name, and an associated description. The switch uses neutral and primary Strapi theme colors. The vertically segmented Toggle is no longer used for settings.
- The three security feature switches now use equal full-width rows. The unpaired failed-login number field spans the full settings width. The encryption-key label and input use the available width; at 519 CSS pixels and below, the Show button moves beneath the field. The Generate, Copy, and Copy for .env actions wrap inside the card.
- Multi-sentence policy, strict-enforcement, proxy, warning, and footer copy now use real paragraph separation. Missing enforcement strings were added for English, German, Spanish, French, and Portuguese. The Settings API, saved values, routes, RBAC, and end-user-only session scope did not change.
- Plugin verification: 328/328 tests passed, including the new switch, full-width-field, responsive encryption-field, alert-nesting, paragraph-rhythm, and five-locale checks. Frontend and backend type checks passed. The plugin build, package verification, server-bundle runtime check, and shared Strapi admin build passed. The workbench rule and skill checks passed 16/16.
- Playwright CLI used a fresh Strapi 5.58.0 host on port 1340 with a new temporary SQLite database. At 320, 390, 519, 520, 767, 768, 1024, 1079, 1080, and 1440 CSS pixels, the Security Settings document had no horizontal overflow, no controls outside the main content, no toggle-copy overlap, and all five switches measured 40 by 24 CSS pixels. The encryption label did not overflow at any tested width. The unpaired failed-login input measured 212 px at 320 and 892 px at 1440.
- All five Settings accordions were checked at 320, 390, 1024, and 1440 CSS pixels. The visible switch counts were General 0, Security 5, Geofencing 1, Email 1, and Webhook 1. No panel overflowed or clipped its controls.
- All eight switches changed and returned to their original checked state through Playwright pointer interaction. The Strict Session Enforcement switch also toggled with Space, showed a 2-pixel visible focus outline, and remained associated with its description. Generate Key produced a 32-character test value; Show/Hide worked; both copy actions were tested against a clipboard stub. No settings PUT request occurred, and settings were not saved.
- The browser reported zero console errors. Two warnings remained from Strapi's React Router v7 future-flag notice and useRBAC deprecation notice. The test administrator's interface-language selector offered only English, so German text was validated through the locale tests but not visually rendered in the host.
- The shared workbench UI/UX reference and the Session Manager maintenance skill now distinguish the vertical Toggle from the horizontal Switch to prevent the same component mismatch.
- The requested port 1338 process and database were left untouched. The temporary host used a synthetic local administrator and default plugin settings only. No pre-existing Strapi Admin or end-user sessions were touched. After stopping the host, both temporary SQLite directories were moved to macOS Trash and remain recoverable.
