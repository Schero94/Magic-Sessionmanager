# Magic Session Manager Text Rhythm Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make explanatory text across the Magic Session Manager plugin more readable with consistent paragraph, hint, and list spacing while preserving compact data presentation.

**Architecture:** Add a shared readable-copy style and apply it to explanatory plugin content, with a separate field-hint treatment. Scope paragraph rhythm to prose surfaces and explicitly exempt metric and metadata layouts. Keep all copy, translations, APIs, and runtime behavior unchanged.

**Tech Stack:** React, Strapi Design System 2.2.4, styled-components 6, Node test runner, TypeScript check, Playwright CLI.

---

### Task 1: Add a failing text-rhythm regression test

**Files:**
- Create: `tests/admin-text-rhythm.test.mjs`

**Acceptance:** The test describes shared readable copy styles, field-hint line-height/spacing, their adoption on all target surfaces, and compact metric exceptions. Run it first and confirm it fails because the shared style does not yet exist.

### Task 2: Implement shared copy and field-hint rhythm

**Files:**
- Create: `admin/src/components/ReadableText.jsx`
- Modify: `admin/src/components/FormField.jsx`
- Modify: `admin/src/components/PluginPageLayout.jsx`
- Modify: `admin/src/pages/HomePage.jsx`
- Modify: `admin/src/pages/ActiveSessions.jsx`
- Modify: `admin/src/pages/Analytics.jsx`
- Modify: `admin/src/pages/Settings.jsx`
- Modify: `admin/src/pages/License.jsx`
- Modify: `admin/src/components/SessionInfoPanel.jsx`
- Modify: `admin/src/components/SessionDetailModal.jsx`
- Modify: `admin/src/components/OnlineUsersWidget.jsx`

**Acceptance:** Explanatory copy shares a readable line-height and spacing. Metrics, field labels, and short metadata keep compact styling. No copy, translation, API, or backend behavior changes.

### Task 3: Verify regressions and responsive acceptance

**Files:**
- Test: `tests/admin-text-rhythm.test.mjs`
- Run: `npm test`
- Run: `npm run test:ts:front`
- Run: `npm run build`, `npm run verify`, and `npm run verify:runtime`
- Run: shared `npm run app:build`
- Browser: Playwright CLI at 320, 390, 1024, and 1440 CSS pixels when safe authenticated access is available.

**Acceptance:** All local tests and builds pass. Report browser checks independently and identify any authentication or visual-capture limitation without calling it a pass.
