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
