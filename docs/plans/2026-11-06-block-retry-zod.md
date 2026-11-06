# Retry-safe blocking and Zod remediation implementation plan

**Goal:** Remove ambiguous toggle retries and investigate a safe Strapi 5-compatible Zod remediation without claiming unverified downstream safety.

**Architecture:** The authorized admin handler consumes an explicit desired state. Its caller supplies the state chosen at confirmation; block retries invoke revocation again. Validate behavior through the real isolated Strapi host in legacy and refresh modes. Audit and test dependency changes independently.

**Tech Stack:** Strapi 5, Node.js, React, SQLite fixture, npm.

1. Extend `tests/isolated-http-access.test.js` for explicit block, failure/retry, lost response, explicit unblock and rejected bodyless/malformed requests; run both modes and establish failures.
2. Update `server/src/controllers/session.js`, route description, `admin/src/components/SessionInfoPanel.jsx` and API documentation; retain RBAC and response envelopes. Rerun HTTP, controller and frontend tests in both modes.
3. Recheck registry and production audits; investigate patched Strapi and Zod versions and target-host constraints. Test any candidate only in an isolated clean host before changing lockfiles; record unresolved residual findings.
4. Run applicable type, build, runtime and browser checks against final code. Record open concurrency, multi-database and release gates without claiming complete acceptance.
