# Session Manager modal UX implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the relaxed-mode warning layout and make session details easier to scan, while proving that administrators can end only active Users & Permissions sessions through the existing protected API.

**Architecture:** Keep Strapi Design System `Alert` and modal primitives. Apply a scoped full-width title/body layout to the warning. Extract small pure presentation helpers for browser versions and date formatting, render session values as responsive semantic label/value pairs, and keep the current termination route, confirmation, notification, and refresh flow. Use Playwright CLI network interception with synthetic data for browser acceptance.

**Tech Stack:** Strapi 5.58.0, `@strapi/design-system` 2.2.4, React, Node 22, `node:test`, Playwright CLI.

---

### Task 1: Add failing presentation regressions

**Files:**
- Create: `tests/session-presentation.test.mjs`
- Create: `tests/admin-modal-layout.test.mjs`

**Steps:**
1. Test browser-version extraction for Chrome, Edge, Firefox, Safari, unknown agents, and native version metadata.
2. Test localized date output and a stable unavailable fallback for invalid timestamps.
3. Add a source contract that requires the relaxed-mode Alert's title and body paragraphs to take full rows, and the modal's label/value groups to use shrink-safe semantic layout.
4. Run the two test files and confirm the new expectations fail before implementation.

### Task 2: Fix the warning layout

**Files:**
- Modify: `admin/src/pages/Settings.jsx`

**Steps:**
1. Add a narrowly scoped styled Strapi `Alert` wrapper that places its title and body paragraphs on separate full-width rows.
2. Wire the dismiss control to local view state. Restore the warning when the strict-enforcement draft changes.
3. Keep the existing warning copy, design-system variant, and translations.
4. Run the warning layout and dismissal tests, then check the real page in Playwright CLI at the acceptance widths.

### Task 3: Improve session detail presentation

**Files:**
- Create: `admin/src/utils/sessionPresentation.mjs`
- Modify: `admin/src/components/SessionDetailModal.jsx`
- Modify: `admin/src/pages/HomePage.jsx` only if sharing its existing session-device mapping is needed
- Modify: `tests/session-presentation.test.mjs`
- Modify: `tests/admin-modal-layout.test.mjs`

**Steps:**
1. Implement and test browser-version and locale-aware date helpers.
2. Replace repeated icon-led rows with responsive semantic label/value pairs under the existing sections.
3. Increase label readability, use shrink-safe columns, and allow long values to wrap.
4. Render explicit fallback values for missing dates and idle time.
5. Preserve active-only termination, the native confirmation, pending state, API path, notification, refresh, and close-on-success behavior.
6. Run focused tests before the full suite.

### Task 4: Exercise modal and logout in the browser

**Files:**
- No new browser automation framework or test runner.
- Evidence recorded in `gates/sessionmanager-modal-ux.md`.

**Steps:**
1. Use the existing authenticated, isolated Chrome tab on port 1340. Do not revisit port 1338 with the exposed local credential.
2. Use Playwright CLI route interception to supply a synthetic end-user session and a local fake termination response. Include embedded synthetic location data so no GeoIP provider request can occur.
3. Open the row and inspect the user, device, timeline, security, and technical data in the modal.
4. Dismiss the confirmation and verify no POST. Reopen, accept, and verify exactly one POST to the existing endpoint, success notification, list refresh, and modal close.
5. Verify the inactive row has no available termination action.
6. Measure document width and warning/modal alignment at 320, 390, 519, 520, 767, 768, 1024, 1079, 1080, and 1440 CSS px. Check keyboard focus, Escape/Close, and console errors.

### Task 5: Re-run quality gates and update evidence

**Files:**
- Modify: `../../docs/audits/2026-10-14/sessionmanager.md`
- Update: `gates/sessionmanager-modal-ux.md`

**Steps:**
1. Run the complete Session Manager tests, frontend/backend TypeScript checks, package verification, runtime verification, and plugin build.
2. Run the shared Strapi admin build.
3. Re-run the task gate checker and record exact results.
4. Update the function matrix to distinguish existing backend logout coverage from the new browser-confirmed UI path.
5. Do not commit, push, release, change other plugins, or touch real user/admin sessions.
