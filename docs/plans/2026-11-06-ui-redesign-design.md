# Session Manager UI/UX redesign: design

Date: 2026-11-06. Branch: `claude/sessionmanager-ui-redesign` (base 596d4b0 = 4.8.0 + uncommitted acceptance work).
Evidence: `docs/audits/2026-11-06-ui-acceptance-review.md` (about 145 verified findings, screenshots from a Strapi 5.61 host).

## Goal

The Session Manager admin should look and behave like a first-party Strapi feature. A user should not be able to tell where Strapi ends and the plugin begins. Work desktop first (1440, 1080–1024), then mobile (768, 390, 320). The layout must be symmetric and measurable: equal heights in a row, one spacing scale, aligned edges.

## Fixed constraints

- Routes, request/response contracts, permissions and server code stay unchanged. Every screen keeps its current data source.
- Admin-only. Strapi Admin sessions stay out of scope; the plugin manages Users & Permissions end-user sessions only.
- Peer range is `@strapi/strapi ^5.0.0`. Use only admin exports that exist in 5.0: `Layouts`, `Page`, `Pagination`, `SearchInput`, `ConfirmDialog`, `Form`/`Blocker`, `useNotification`, `useFetchClient`, `useQueryParams`, `useAPIErrorHandler`, `useRBAC`. Feature-detect newer exports such as `Widget` helpers and `useIsMobile` and fall back when they are missing.
- Design System 2: components, theme tokens, spacing scale and breakpoints only. No hand-made replacements for DS pieces, no hard-coded colours and no px font sizes.
- Every visible string goes through `formatMessage`, with keys present in en, de, fr, es and pt. German uses the formal *Sie* consistently.

## Current state (summary of the review)

- The layout is not native: plugin padding inside `Layouts.Content` insets content 24–48 px from the page title; emoji and VS Code colours appear in headings; there are five unequal stat cards, a hand-made table wrapper and a custom 768 px breakpoint.
- The dashboard table has `minWidth: 1024`, so the Actions column is clipped even at 1440 px. Row actions cannot be reached by keyboard (DASH-01). Refreshes unmount the list and lose focus.
- Wording is inconsistent ("Active" vs "ONLINE", "Unavailable on Unavailable", `[WARNING] Yes`). Dates use browser locale in the table and admin locale in the modal.
- Settings is one 2269-line file with five accordions, no unsaved-changes guard, no inline validation and a broken "Copy for .env" (keys containing `#`). Saving shows the draft even when the server stored a sanitized value.
- Blocking a user from the user panel leaves the Content Manager form stale; the next Save unblocks the user.
- Analytics bar labels fail contrast; the widget overflows at 320 px; destructive actions use `window.confirm`.

## Design system for this plugin (symmetry rules)

One small set of shared building blocks in `admin/src/components/ui/`, used by every screen:

| Block | Purpose | Rules |
|---|---|---|
| `PageShell` | `Page.Main` + `Layouts.Header` + optional `Layouts.Action` + `Layouts.Content` | No extra padding inside Content. Primary action sits in the header. |
| `SectionCard` | White content section | `background="neutral0" hasRadius shadow="tableShadow"`, padding 6 (24 px) desktop and 4 (16 px) below the medium breakpoint; heading `Typography variant="delta" tag="h2"`, optional subtitle `variant="pi" textColor="neutral600"`. |
| `StatGrid` / `StatCard` | KPI rows | `Grid.Root gap={4}`, equal columns (4 per row desktop, 2 tablet, 1 mobile), stretch to equal height; value `variant="alpha"`, label `variant="sigma"`. |
| `PropertyList` | Label/value pairs (modal, panel, license) | `dl` with a two-column grid of equal width; labels `sigma`, values `omega`; long values wrap with `overflow-wrap: anywhere` only for IDs and emails. |
| `StatusBadge` | All session states | One mapping for every screen: Active (success), Idle (warning), Logged out (neutral), Terminated (danger). |
| `ConfirmAction` | All destructive actions | Strapi `ConfirmDialog`; never `window.confirm`. |

Spacing scale (DS tokens only): 1 = 4 px, 2 = 8 px, 3 = 12 px, 4 = 16 px, 6 = 24 px, 8 = 32 px. Use gap 2 inside a control group, 4 inside a card, 6 between cards and sections. Controls in one row use the same size (`M`, 40 px). Breakpoints: DS `small` 520, `medium` 768, `large` 1080.

Formatting: one `formatSessionDate` helper using the admin locale (`useIntl`) everywhere, with relative time through `FormattedRelativeTime`. Missing values show "—" with an accessible label, never "Unavailable on Unavailable".

## Screens (target state)

### 1. Dashboard (`/plugins/magic-sessionmanager`)

Native list-view pattern, as in the Content Manager:
- Header: title, subtitle, primary action "Export" (`SimpleMenu`: CSV, JSON).
- `StatGrid` with 4 equal cards: Active, Idle, Ended (secondary line: "x logged out · y terminated"), Total.
- Action bar: `SearchInput` on the left; status filter (`SingleSelect`, size M) and Refresh `IconButton` on the right.
- Table (DS `Table`), with no fixed min-width. Columns: Status, User (name + email, ellipsis with title), Device (icon + "Safari 17 · macOS"), IP, Last active (relative + absolute in tooltip), Actions (`IconButtonGroup`: View, Log out, Delete; each label includes the user name). Clicking a row opens the modal; rows are not extra tab stops.
- Footer: native `Pagination` (page size + links) with the current query in the URL (`useQueryParams`).
- Refresh keeps the table mounted (inline loader, focus preserved). An empty state and a no-results state with "Clear filters".
- Below the large breakpoint: the table is replaced by a card list using the same columns as `PropertyList`, with actions in a row of equal-width buttons.

### 2. Session detail modal

- Header: device icon, "Session details", `StatusBadge`; the ID moves into the technical section with a copy button (`useClipboard`).
- Body: `PropertyList` sections User, Session (login, last active, idle time), Device, Location & security (VPN/proxy as Badge "Yes/No", risk as translated level). Two columns on desktop, one below the small breakpoint.
- Footer: Close (tertiary) on the left, "Log out session" (danger-light) on the right through `ConfirmAction`; disabled with an explanation when the session is already inactive.

### 3. Settings (`/settings/magic-sessionmanager/general`)

- Split `Settings.jsx` into `pages/Settings/index.jsx` plus one file per section and a `useSettingsForm` hook (load, draft, dirty, validate, save, reset).
- Header: title, subtitle, primary "Save" (disabled when clean, loading while saving), secondary "Reset". A `Blocker` warns before navigating away with unsaved changes.
- DS `Tabs`: General · Security · Geofencing · Notifications (email + webhooks). Each tab is a stack of `SectionCard`s with `Grid` 2 columns (6/6) on desktop and 1 column below medium; field heights are equal per row.
- Inline validation with `Field.Error` for every numeric/URL field, including min/max, and no silent clamping in the UI.
- After a save, the form re-reads the server response so the UI shows exactly what was stored.
- "Copy for .env" quotes the value (`KEY="…"`) so `#` survives; a newly generated key stays hidden until revealed.
- Geofencing: mode as a DS `Radio` group (Allowlist/Blocklist) with an explicit confirm when switching would clear the other list; countries via `Combobox` with typeahead; chips as `Tag` with focus moving to the next chip after removal.
- Email templates: a native `Textarea` with a monospace token in DS colours, a variable list as `Tag`s, the preview inside a `SectionCard`. No emoji, no VS Code colours.
- Danger zone: its own `SectionCard` with a danger heading; "Clean now" through `ConfirmAction`; the button wraps below the text below the small breakpoint.
- Privacy disclosure for the IP lookup sits next to the "IP geolocation" switch that actually enables it.

### 4. Analytics (`/settings/magic-sessionmanager/analytics`)

- `StatGrid` with 4 KPIs; then two equal-height `SectionCard`s per row (Devices, Browsers), then the timeline at full width.
- Bars: DS `ProgressBar`-style track with the value label outside the fill, so contrast holds in both themes. Labels translated; "Average duration" excludes idle-cleanup time, or the description says that it includes it (documentation only; no server change).

### 5. Activation / license (`/settings/magic-sessionmanager/license`)

- `SectionCard` "Licence status" with `PropertyList`; activation details only when a key exists.
- Key field: a password-type field with reveal and copy via `useClipboard`; Download/Refresh as secondary actions in the header. Refresh keeps the page mounted.

### 6. Home widget "Online users"

- Use `Widget.Loading/Error/NoData` when available and a local fallback otherwise.
- 2×2 equal grid of stat tiles (Online now, Last 15 min, Last hour, Today) plus a link "Open Session Manager". No horizontal overflow at 320 px.

### 7. User panel (Content Manager → User)

- Summary: `StatusBadge` + "n active sessions"; actions "Log out all" and "Block/Unblock" as full-width buttons of equal height through `ConfirmAction`, each showing its own spinner.
- After block/unblock, update the open form's `blocked` field via the edit view's form context (`useForm` from `@strapi/strapi/admin`) and fall back to a reload notice if the context is absent, so a later Save cannot revert it.
- Session list: compact cards with icon, translated device name, browser · OS, IP, relative time; at most 5 with "Show all" linking to the dashboard filtered to that user.
- Render nothing for any model other than `plugin::users-permissions.user`.

## Accessibility

Heading tree h1 → h2 → h3 on every screen; `IconButton` with a contextual `label` for every icon action; decorative icons `aria-hidden`; focus moves back to the trigger after every dialog and stays in place after refresh, delete and pagination. Contrast is at least 4.5:1 for text in light and dark mode. Touch targets are at least 32 px below the medium breakpoint.

## Verification (gates for this branch)

1. Tests first: unit tests for the shared blocks and helpers (formatting, status mapping, env quoting, settings validation, save round-trip, panel form sync). Source-contract tests: no `window.confirm`, no emoji in JSX, no hex/rgb colours or px font sizes in `admin/src`, every `formatMessage` id present in all five locales.
2. Full plugin suite, both type checks, plugin build and verify; shared host admin build on Strapi 5.61.
3. Browser matrix on an isolated host with synthetic data: 1440, 1080, 1024, 768, 520, 390, 320; light and dark. For every screen it measures: document overflow = 0; height difference of siblings in one grid row = 0 px; gaps between siblings are in {4, 8, 12, 16, 24, 32} px; equal left edges of section cards and the page title; contrast at least 4.5:1; full keyboard walk with visible focus; 0 plugin console errors.
4. Before/after screenshots for every screen; new README screenshots (`pics/`) and the GitHub Page gallery from the same synthetic data.

## Out of scope here (reported for the server/acceptance owner)

These come from the review. They need server or release decisions and are not changed in this branch:

- API-1: the rate limiter is keyed on the raw path and can be bypassed. API-5: settings can loosen the write rate limit. API-6: the settings PUT resets omitted fields. API-7/8/9: error status and cleanup robustness.
- GA-09/API-4: the uncommitted toggle-block response change in the base is a breaking contract change without a major version or changelog entry.
- GA-01: `tests/isolated-fallback-logout-http.test.js` hard-fails outside the workbench layout.
- GA-03: 4.8.0 was released although its audit said not to publish; GA-02/05/06 gate entries marked done are not supported by their evidence.
