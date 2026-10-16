# Magic Session Manager UI symmetry pass

## Current state

- The Strapi 5 plugin dashboard has five unframed statistic values and three filters with different widths. The end-user session list is already split into desktop table and mobile cards.
- General settings use the Strapi 12-column grid with a 24 px gutter. At 320 px the columns collapse to zero width while a 12-column item retains the total gutter width, so select controls extend past their settings card. Settings labels and helper text are a mix of Strapi Field components and unassociated Typography nodes.
- The disabled “No Changes” action sits in a full-width white strip, leaving a large empty block above settings.
- Several cards and chart details use the old `--colors-*` CSS variable names. Those variables are not part of the installed Strapi Design System 2.2.4 theme, so the surfaces and borders disappear.
- Analytics, activation, session details, and the Users & Permissions user side panel share the plugin’s mixed old-token styling.

## Target state

- Keep the Strapi-native component language and the plugin’s restrained indigo identity. Use the active Strapi theme for surfaces, borders, and text so light and dark themes remain coherent.
- Give all settings and dashboard filter fields the Strapi `Field.Root`, `Field.Label`, and `Field.Hint` structure. Inputs, textareas, number inputs, and selects fill the same grid column and never exceed it.
- Give dashboard search, status, and page-size fields equal desktop columns, then stack them on narrow screens.
- Keep paired fields in equal desktop columns with aligned labels and controls. At Strapi's 520 px small breakpoint, settings grids become one column and page gutters contract. Keep long descriptions readable and avoid forcing equal fixed heights on text.
- Move save/reset actions into the Strapi page header. Show them only when there are unsaved changes, removing the empty full-width save strip while retaining the explicit save action.
- Restore clear card boundaries on dashboard and analytics. Keep session rows, details, and the Users & Permissions panel readable on narrow screens.
- Preserve existing setting names and values, API routes, response contracts, destructive confirmations, and end-user-only session scope. Do not change backend behavior or Strapi Admin session handling.

## Acceptance criteria

1. Every editable settings control and dashboard filter has a visible, programmatically associated label and a concise description. Sensitive inputs remain password-masked.
2. Selects, inputs, textareas, and number inputs use the full available field width; paired settings controls share equal widths on desktop and stack on mobile.
3. At 320, 390, 1024, and 1440 CSS pixels, plugin content has no unintended horizontal overflow. Session tables may scroll within their own labelled table container when the viewport cannot fit all columns.
4. Existing values and behavior are unchanged when fields are untouched. Save, reset, exports, filters, detail actions, and explicit destructive confirmations remain available.
5. Plugin tests, frontend TypeScript, plugin build, shared Strapi build, and authenticated Playwright checks pass. Playwright covers Settings, Dashboard, Analytics, Activation, modal layout, and field dimensions without saving settings or triggering session mutations.

## Documentation checked

- Strapi 5 Design System migration notes: https://docs.strapi.io/cms/migration/v4-to-v5/breaking-changes/design-system
- Strapi Design System v2 migration guide: https://github.com/strapi/design-system/blob/main/docs/stories/00-getting%20started/migration%20guides/migration-v1-v2.mdx
- Strapi Design System responsive foundations: https://github.com/strapi/design-system/blob/main/docs/stories/01-foundations/responsive.mdx
- Strapi Design System grid foundations: https://github.com/strapi/design-system/blob/main/docs/stories/01-foundations/grid.mdx
- Context7 library lookup: `/strapi/design-system`; fetched examples document the Field API and composite `Grid.Root` / `Grid.Item` layout. Installed package checked locally: `@strapi/design-system` 2.2.4.
- Official Strapi Design System v2 migration notes checked again for this follow-up: https://docs.strapi.io/cms/migration/v4-to-v5/breaking-changes/design-system. The notes confirm the v2 Field API and 10 px root rem baseline. Context7's monthly quota was exhausted during this pass, so no new API behavior was taken from it.

## Text rhythm follow-up

### Current state

- Shared field descriptions render through `Field.Hint`, but the plugin does not establish a consistent line-height or readable measure for those hints.
- Several explanatory settings descriptions are standalone `Typography` nodes. Their paragraph semantics and spacing are not consistent across sections.
- Analytics statistic values and labels are paragraph elements with inline zero margins, so they are intentionally compressed even when adjacent explanatory copy would benefit from more space.
- Session detail and Users & Permissions panels mix explanatory copy with compact metadata rows. A blanket global paragraph rule would make those values and metrics too loose.

### Target state

- Use one shared readable-text treatment for explanatory copy: comfortable line-height, a constrained measure for long text, and clear spacing between adjacent paragraphs and list items.
- Give every settings hint the same readable line-height and consistent separation from its control without changing field label/control alignment.
- Apply the rhythm to dashboard/page copy, settings explanations, analytics descriptions, activation messages, session details, and the end-user session panel.
- Keep numbers, badges, table cells, field labels, and short session metadata compact. Do not change copy, translations, behavior, data, routes, or backend contracts.
- Preserve responsive behavior and the existing four-click task journeys.

### Acceptance criteria

1. Explanatory paragraphs use a shared readable line-height and max measure; consecutive paragraphs and list items have explicit, consistent separation.
2. Field hints use the same line-height and a consistent control-to-description gap in all five locales.
3. Dashboard/analytics metrics, table rows, field labels, and session metadata do not inherit paragraph spacing.
4. At 320, 390, 1024, and 1440 CSS pixels, the page has no unintended horizontal overflow; copy wraps without clipping.
5. A focused regression suite protects the shared rhythm and compact-data exceptions. Plugin tests, frontend type-check, plugin build/verify, shared app build, and authenticated browser checks are reported separately. If the local test credential cannot be used safely, authenticated browser acceptance remains explicitly unverified.

### Verification record

- `npm test`: 282 tests passed.
- `npm run test:ts:front`: passed.
- `npm run build`, `npm run verify`, and `npm run verify:runtime`: passed.
- Shared `npm run app:build`: passed.
- `npm run app:dev`: Strapi 5.58.0 started and logged all eight workbench plugin keys.
- Playwright CLI confirmed the unauthenticated Settings route redirects to Strapi login with zero console errors. Authenticated page layout and 320/390/1024/1440 viewport checks were not performed, so those remain open.
- No settings were saved, no session was terminated, and no outbound integration was triggered.
