# Session Manager Dashboard Pagination Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the session dashboard expose every matching result through accessible pagination while keeping exports complete and filters responsive.

**Architecture:** Keep status and search filtering as the canonical full result set. A pure helper will derive the visible page, safe current page, and range metadata; the UI will render that slice in both desktop and mobile views. CSV and JSON exports continue to consume the full filtered set, not the currently visible page.

**Tech Stack:** Strapi 5 Design System, React, `node:test`, Playwright CLI.

---

## Acceptance criteria

- Status and search filters run before pagination and reset the current page to page 1.
- The page-size selector changes the number of visible rows and the page count; previous/next actions never go out of bounds.
- Desktop table and mobile cards render the same page slice.
- Export CSV and JSON include every session matching the active filter/search, across all pages.
- The visible range communicates `start-end of total`, and the current page is announced accessibly.
- The desktop table has one header for each cell; the status header is not duplicated.
- At 390px and 1440px, the dashboard has no document-level horizontal overflow and no plugin console errors.
- No session mutation, export download, provider call, credential generation, stage, commit, or push is part of verification.

## Task 1: Pure pagination contract

**Files:**
- Create: `admin/src/utils/sessionPagination.mjs`
- Create: `admin/src/utils/sessionExports.mjs`
- Create: `tests/session-pagination.test.mjs`
- Create: `tests/session-exports.test.mjs`

1. Add failing tests for first, middle, last, empty, invalid-page, and invalid-page-size inputs.
2. Run `node --test tests/session-pagination.test.mjs` and confirm the missing helper fails.
3. Implement a JSDoc-documented helper returning visible items, normalized page/page count, and start/end indexes.
4. Add pure CSV and JSON serializer tests for complete filtered sets, missing values and CSV escaping. These tests do not write download files.
5. Implement documented serializers and re-run both focused suites. Expect all cases to pass.

## Task 2: Dashboard integration and accessibility

**Files:**
- Modify: `admin/src/pages/HomePage.jsx`
- Modify: `admin/src/translations/en.json`
- Modify: `admin/src/translations/de.json`
- Modify: `admin/src/translations/es.json`
- Modify: `admin/src/translations/fr.json`
- Modify: `admin/src/translations/pt.json`
- Modify: `tests/admin-native-ui.test.mjs`

1. Add failing UI contract tests for the page slice, full-filter exports, responsive result lists, one status header, and all five locale keys.
2. Integrate the helper after status/search filtering. Reset to page 1 on query/filter/page-size changes.
3. Render previous/next Strapi buttons and localized range/page labels only when more than one page exists.
4. Use the same visible slice for the desktop table and mobile cards. Pass the unsliced filtered set to the pure export serializers.
5. Remove the duplicate desktop status header.
6. Run `node --test tests/session-pagination.test.mjs tests/session-exports.test.mjs tests/admin-native-ui.test.mjs tests/admin-session-display.test.mjs` and expect all tests to pass.

## Task 3: Full verification

1. Run `npm test`, `npm run test:ts:front`, `npm run test:ts:back`, `npm run build`, `npm run verify`, and `npm run verify:runtime` in the plugin checkout.
2. Run `npm run app:build` from the workbench root and use the already isolated Strapi test host.
3. Playwright-check search, status filtering, page-size, previous/next and page range at 390px and 1440px. Do not invoke destructive controls or download session data.
4. Record measured evidence in the native acceptance gate and append the result to the parent plan status log. Keep every unrelated dirty change intact.

## Completion evidence

- `npm test`: 262 passed, 0 failed. Frontend and backend TypeScript checks, plugin build, package verify, runtime bundle verify and the shared Strapi app build passed.
- Playwright at 390x844 showed 1-10, 11-20 and 21-22 of 22 sessions at page size 10. Previous/Next boundary states, status filtering, search reset and the no-results clear action worked. The desktop table had seven matching headers and ten rows at page size 10.
- CSV and JSON serializers are covered by pure tests for complete filtered results, escaping and unavailable values. Playwright clicked both export buttons with Blob interception and checked only row counts, headers and token-field absence. No download file was created.
