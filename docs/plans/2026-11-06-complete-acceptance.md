# Complete Session Manager Acceptance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the approved native Strapi UI and security acceptance for all plugin surfaces on current main.

**Architecture:** Preserve plugin route paths, response envelopes, role and owner boundaries, native and legacy end-user session modes and Strapi admin chrome. Review each reachable UI screen and endpoint against existing inventories; add failing tests before changing behavior. Use a disposable isolated host with synthetic data and fake external services. The existing design in `2026-11-06-release-readiness-design.md` and detailed `2026-10-16-sessionmanager-functional-acceptance.md` remain the approved starting contract.

**Tech Stack:** Strapi 5, Strapi Design System 2, React 18, Node 22, node:test, Playwright CLI.

## Parallel ownership and gates

- Endpoint/security leaf owns `server/src/routes/**`, `server/src/controllers/**`, `server/src/policies/**`, and endpoint-specific tests, plus `gates/complete-acceptance-api.md`. Inventory each route and applicable access cases, build a matrix grounded in executable tests, identify and fix concrete defects with failing tests first. Do not alter services or UI without coordinating.
- Privacy/dependencies leaf owns `server/src/services/geolocation.js`, `server/src/config/**`, `server/src/utils/settings-loader.js`, package metadata/lockfiles, privacy-specific tests and `gates/complete-acceptance-privacy.md`. Review external data flow, safe defaults versus compatibility and advisories. Do not change controllers or UI without coordinating.
- UI leaf owns `admin/**`, UI-specific tests and `gates/complete-acceptance-ui.md`. Follow Strapi-native component rules, review each screen and states, fix evidenced defects with failing tests first, and leave browser acceptance to integration unless an isolated browser is independently available. Do not edit server files.
- Integration owner retains `GATES.md`, this plan and `gates/complete-acceptance-integration.md`. Independently rerun checks, build an isolated host, exercise all real UI actions and endpoint deny cases, resolve integration, record evidence and final status. Never push, publish, contact live providers or touch existing sessions.

Leaf reports must name exact changed files, observed tests and open gates. Tests alone cannot prove visual acceptance or total security. No shared file edits without coordination; no concurrent installation into another checkout's node_modules.

## Status

- 2026-11-06: Initial baseline is commit `c9ba929` from origin/main. Historical acceptance evidence is dated and will be rechecked.
- 2026-11-06: `c9ba929` is itself the semantic-release commit for **4.8.0**. 4.8.0 was released before this acceptance closed, although `docs/audits/2026-11-06-release-readiness.md` (shipped in that release) says "Do not publish this branch as a release yet." This cannot be undone. 4.8.0 is not accepted; its known defects are listed in `GATES.md` ("Release status"). The next release must carry the fixes and may only be cut after N1–N6 close (GA-03).
- 2026-11-06: The UI/acceptance review (`docs/audits/2026-11-06-ui-acceptance-review.md`) found that several checked gates were not supported by their evidence. G7, G8, G9 and G11 in `GATES.md`, U3 and A3 in the leaf gates, and S3 in the root workbench gate `gates/pages-sessionmanager.md` are now unchecked or marked superseded (GA-02, GA-05, GA-06, API-2, UX-17). The root workbench gates check `plugins/Magic-Sessionmanager` at `2f00880` (4.7.2) and are historical for this work (GA-07).
- 2026-11-06: Work continues on branch `claude/sessionmanager-ui-redesign` (worktree `.tmp/sessionmanager-ui-redesign`, base `596d4b0`/`b21c097`). Design: `docs/plans/2026-11-06-ui-redesign-design.md`. Leaf gates for that branch: `gates/ui-redesign.md`. Ownership there: the dashboard/modal, Settings, analytics/license, widget/panel, foundation (`admin/src/components/ui`), server and i18n areas each belong to one agent; the gates/docs integrator owns `GATES.md`, `gates/**`, `CHANGELOG.md` and this plan.
