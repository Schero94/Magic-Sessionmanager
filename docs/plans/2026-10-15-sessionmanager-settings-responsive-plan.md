# Magic Session Manager Settings Responsive Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore discoverable Strapi settings navigation and make every Settings switch and explanatory field responsive and visually consistent.

**Architecture:** Migrate settings registration to Strapi 5.58's supported `addSettingsLink` API without changing route ids or permissions. Replace duplicate vertically stacked switch cards with one accessible horizontal row component. Constrain copy and field hints to their parent width. Guard the contract with focused tests.

**Tech Stack:** Strapi 5.58.0, Strapi Design System 2.2.4, React, styled-components, Node test runner, Playwright CLI.

---

### Task 1: Add failing navigation, toggle-layout, and text-width tests

**Files:**
- Create: `tests/admin-settings-responsive.test.mjs`
- Modify: `tests/plugin-standards.test.mjs`

**Acceptance:** Tests fail on deprecated section registration, missing explicit copy width constraints, non-shared/vertical toggle markup, or missing always-applied responsive design guidance.

### Task 2: Update Strapi settings navigation

**Files:**
- Modify: `admin/src/index.js`
- Test: `tests/admin-settings-responsive.test.mjs`

**Acceptance:** Use `addSettingsLink` with section metadata `{ id, intlLabel }`; preserve the existing three settings link ids, paths, and permission arrays.

### Task 3: Use Strapi Switch rows with readable responsive copy

**Files:**
- Create: `admin/src/components/SettingsToggleRow.jsx`
- Modify: `admin/src/pages/Settings.jsx`
- Modify: `admin/src/components/ReadableText.jsx`
- Modify: `admin/src/components/FormField.jsx`
- Test: `tests/admin-settings-responsive.test.mjs`

**Acceptance:** All eight settings use the shared row with the Strapi Design System Switch, not Toggle. Each switch exposes its title and description accessibly, and Off/On labels are not stacked inside the control. Related security rows use a consistent width, and unpaired form fields use the full available width. Values, callbacks, confirmations, routes, and permissions stay unchanged. Existing wording remains unchanged; missing locale strings are filled with equivalent translations.

### Task 4: Strengthen cross-plugin rules and skills

**Files:**
- Modify: `templates/strapi-plugin-quality.mdc`
- Synchronize: root and all eight plugin `.cursor/rules/strapi-plugin-quality.mdc`
- Modify: workbench `.agents/skills/strapi-workbench/SKILL.md`
- Modify: global Strapi workbench skill
- Modify: Magic Session Manager `.agents/skills/strapi-plugin-maintenance/SKILL.md`
- Test: `tests/plugin-standards.test.mjs`

**Acceptance:** All plugin projects enforce current Strapi docs, shared Design System components, horizontal switch rows, and responsive checks at 320/390/1024/1440 CSS pixels. UI changes require actual Playwright evidence before claiming visual acceptance.

### Task 5: Verify without persisting settings

**Files:**
- Run: `npm test`, `npm run test:ts:front`, `npm run build`, `npm run verify`, `npm run verify:runtime`
- Run: shared `npm run app:build` and `npm run app:dev`
- Browser: Playwright CLI navigation, labels, toggle geometry, overflow, console and keyboard checks at required widths when authenticated access is available.

**Acceptance:** No settings are saved; no session actions or external integrations are triggered. Report browser limitations explicitly. Measure the full Strapi breakpoint matrix and distinguish plugin checks from the shared admin build and authenticated Playwright evidence.
