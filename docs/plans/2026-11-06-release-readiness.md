# Magic Session Manager Release Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare the Session Manager for a safe, independently verifiable Strapi 5 release.

**Architecture:** Preserve the plugin's native Strapi admin and native/legacy session contracts. Use isolated test data and fake external integrations, and report each verification layer separately.

**Tech Stack:** Strapi 5, React 18, Node 22, node:test, Playwright CLI.

## Tasks and gates

1. Inspect the existing acceptance plan, route policies, privacy boundaries, dependencies and npm audit; record current versions and any risks.
2. Install and test the latest compatible Strapi 5 in the isolated plugin checkout. Update its lockfile and declared dependency only where needed. Never downgrade Strapi to silence audit findings.
3. For each verified behavioral defect, specify the contract, add a failing focused regression, fix it, and rerun that test. Preserve existing API compatibility.
4. Run `npm test`, `npm run test:ts:back`, `npm run test:ts:front`, `npm run build`, `npm run verify`, `npm run verify:runtime`, `npm audit --omit=dev`, and `npm pack --dry-run`. Record exact outcomes.
5. Build and start an isolated shared host using compatible Strapi and an isolated database. Exercise all reachable plugin screens and API paths using synthetic data and provider fakes. Use Playwright CLI only; check the breakpoint matrix, actions, accessibility, overflow and errors.
6. Repeat relevant quality and UI checks after fixes. Record open release gates, upstream advisories, package metadata and the absence of a publish or push.
