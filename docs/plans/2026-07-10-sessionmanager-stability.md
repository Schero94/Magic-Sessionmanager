# Session Manager Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix every confirmed stability defect in Magic Session Manager while preserving its existing public plugin endpoints.

**Architecture:** Keep the plugin-owned Session content type and add small, testable helpers for auth-route classification, refresh-token extraction, session status, and analytics. Enforce session state at JWT verification time, update activity after Strapi route authentication, and use conditional token rotation plus per-token serialization so failed or concurrent authentication operations cannot emit untracked credentials.

**Tech Stack:** Node.js 20+, Strapi 5.50, Koa middleware, Strapi Document Service and Query Engine, React 18, node:test.

---

### Task 1: Establish Shared Authentication Classification

**Files:**
- Create: `server/src/utils/auth-routes.js`
- Modify: `server/src/bootstrap.js`
- Test: `tests/auth-routes.test.js`

**Step 1: Write the failing tests**

Cover local login, registration, reset-password, email-confirmation, OAuth callback,
magic-link/passwordless paths, authenticated change-password rotation, refresh, and
non-auth paths. Assert that registration/reset/OAuth require the pre-auth GeoIP guard
and that change-password is classified as `rotate-current`.

```js
assert.equal(classifyJwtIssuingRequest('/api/auth/local/register', 'POST'), 'new-session');
assert.equal(classifyJwtIssuingRequest('/api/auth/change-password', 'POST'), 'rotate-current');
assert.equal(shouldRunPreAuthGeoGuard('/api/auth/google/callback', 'GET'), true);
assert.equal(isFailedLoginTrackedPath('/api/auth/reset-password', 'POST'), false);
```

**Step 2: Run the test and verify failure**

Run: `node --test tests/auth-routes.test.js`
Expected: FAIL because `server/src/utils/auth-routes.js` does not exist.

**Step 3: Implement the classifier**

Export `classifyJwtIssuingRequest`, `shouldRunPreAuthGeoGuard`, and
`isFailedLoginTrackedPath`. Replace the independent `isLoginPath` and
`isJwtIssuingPath` implementations in `bootstrap.js` with these helpers.

**Step 4: Run the test and existing GeoIP tests**

Run: `node --test tests/auth-routes.test.js tests/geo-firewall.test.js`
Expected: PASS.

### Task 2: Correct Last-Seen Ordering And Inactivity Enforcement

**Files:**
- Modify: `server/src/middlewares/last-seen.js`
- Modify: `server/src/bootstrap.js`
- Test: `tests/last-seen.test.js`
- Create: `tests/session-aware-jwt.test.js`

**Step 1: Add realistic failing middleware tests**

Start with an empty `ctx.state`; populate `ctx.state.user` inside `next()`. Assert the
exact token-matched session is touched after the route, while logout routes and failed
responses are not touched.

```js
await middleware(ctx, async () => {
  ctx.state.user = { documentId: 'user-doc' };
  ctx.status = 200;
});
assert.equal(touchCalls, 1);
```

**Step 2: Add failing JWT inactivity tests**

Expose narrowly-scoped bootstrap internals under `module.exports.__private`. Mock an
active session whose `lastActive` exceeds the configured timeout. Assert verification
returns `null`, writes `isActive: false`, and stores reason `idle`. Also retain tests for
active, manual, blocked, expired, and legacy inactive rows.

**Step 3: Run tests and verify failures**

Run: `node --test tests/last-seen.test.js tests/session-aware-jwt.test.js`
Expected: FAIL on post-auth touch and active-row inactivity.

**Step 4: Implement the lifecycle correction**

Make last-seen await downstream authentication before inspecting `ctx.state.user`,
then touch only successful authenticated requests. In the JWT wrapper, calculate idle
time before the early active-session return and terminate stale active rows immediately.

**Step 5: Run focused tests**

Run: `node --test tests/last-seen.test.js tests/session-aware-jwt.test.js tests/session-policy.test.js`
Expected: PASS.

### Task 3: Make Login, Password Change, And Refresh Fail Closed

**Files:**
- Create: `server/src/utils/refresh-token.js`
- Modify: `server/src/services/session.js`
- Modify: `server/src/bootstrap.js`
- Modify: `server/src/content-types/session/schema.json`
- Modify: `server/src/middlewares/session-rejection-headers.js`
- Test: `tests/auth-interceptors.test.js`
- Test: `tests/session-service.test.js`

**Step 1: Write failing token-extraction tests**

Cover JSON body tokens, configured HttpOnly cookie names, response `Set-Cookie`
headers, and absent tokens.

```js
assert.equal(getIncomingRefreshToken(ctx, strapi), 'old-refresh');
assert.equal(getOutgoingRefreshToken(ctx, strapi), 'rotated-refresh');
```

**Step 2: Write failing interceptor tests**

Assert:
- failed session creation replaces a JWT response with HTTP 503;
- change-password rotates the current token-matched session;
- body refresh rotates access and refresh hashes;
- HttpOnly-cookie refresh rotates both hashes;
- two concurrent refreshes produce one success and one 401;
- a persistence/update error produces HTTP 503 and no JWT body;
- built-in Strapi logout terminates the plugin session by refresh-token hash.

**Step 3: Run tests and verify failure**

Run: `node --test tests/auth-interceptors.test.js tests/session-service.test.js`
Expected: FAIL for cookie refresh, change-password, concurrency, and fail-closed behavior.

**Step 4: Implement conditional rotation**

Add `rotateSessionTokens` to the session service. Hash/encrypt the new credentials and
perform a conditional Query Engine update requiring the old refresh/token hash and
`isActive: true`; return `false` when no row changed. Add a composite refresh-token
index during bootstrap.

**Step 5: Serialize refresh reuse and fail closed**

Use a bounded per-refresh-hash promise queue around pre-check, downstream refresh, and
post-response rotation. Re-check state after acquiring the lock. Strip `jwt` and
`refreshToken` from failed responses and return a standard 503 envelope. Parse Strapi's
HttpOnly refresh cookie from both request and response.

**Step 6: Add explicit logout reason**

Add `logout` to the schema enumeration. User logout paths use `logout`; admin
termination remains `manual`. Map both to the existing friendly session-ended message.

**Step 7: Run focused tests**

Run: `node --test tests/auth-interceptors.test.js tests/session-service.test.js tests/session-policy.test.js`
Expected: PASS.

### Task 4: Remove Bulk Session Caps

**Files:**
- Modify: `server/src/services/session.js`
- Modify: `server/src/register.js`
- Modify: `server/src/controllers/session.js`
- Test: `tests/session-service.test.js`

**Step 1: Add failing 1,001-session tests**

Model repeated 500-row active batches and assert `terminateSession({ userId })`
terminates all 1,001 rows. Add a no-progress test that aborts after three failed batches.

**Step 2: Run and verify failure**

Run: `node --test tests/session-service.test.js`
Expected: FAIL with one active row remaining.

**Step 3: Implement bounded batching**

Fetch the first active batch repeatedly without an offset, update it, and continue until
empty. Track repeated zero-progress batches. Return the actual count. Delegate the user
block lifecycle to this service and expose counts from admin controllers.

**Step 4: Run focused tests**

Run: `node --test tests/session-service.test.js`
Expected: PASS.

### Task 5: Honor GeoIP And Notification Settings

**Files:**
- Modify: `server/src/services/session.js`
- Modify: `server/src/controllers/session.js`
- Modify: `server/src/utils/enhance-session.js`
- Modify: `server/src/utils/geo-firewall.js`
- Modify: `server/src/bootstrap.js`
- Test: `tests/session-service.test.js`
- Test: `tests/geo-firewall.test.js`
- Create: `tests/notifications-flow.test.js`

**Step 1: Add failing tests**

Assert session listing performs zero GeoIP calls and zero geo writes when geolocation,
geofencing, and suspicious blocking are disabled. Assert VPN blocking does not depend on
the email alert toggle. Assert VPN/Proxy email delivery calls `sendVpnProxyAlert` when
enabled.

**Step 2: Run and verify failure**

Run: `node --test tests/session-service.test.js tests/geo-firewall.test.js tests/notifications-flow.test.js`
Expected: FAIL on all three confirmed defects.

**Step 3: Implement settings gates**

Only pass a geolocation service into enhancement when a location feature requires it.
Use nullish coalescing when persisting a zero security score. Remove
`alertOnVpnProxy` from firewall decisions and route VPN/Proxy notification events to the
existing service/template.

**Step 4: Run focused tests**

Run: `node --test tests/session-service.test.js tests/geo-firewall.test.js tests/notifications-flow.test.js tests/geolocation-local-mmdb.test.js`
Expected: PASS.

### Task 6: Synchronize Defaults And Admin Reporting

**Files:**
- Modify: `server/src/config/index.js`
- Modify: `server/src/controllers/settings.js`
- Create: `admin/src/utils/sessionStatus.mjs`
- Create: `admin/src/utils/sessionAnalytics.mjs`
- Modify: `admin/src/utils/onlineStats.mjs`
- Modify: `admin/src/pages/HomePage.jsx`
- Modify: `admin/src/pages/Analytics.jsx`
- Modify: `admin/src/translations/en.json`
- Modify: `admin/src/translations/de.json`
- Modify: `admin/src/translations/es.json`
- Modify: `admin/src/translations/fr.json`
- Modify: `admin/src/translations/pt.json`
- Test: `tests/settings.test.js`
- Test: `tests/online-stats.test.mjs`
- Create: `tests/session-status.test.mjs`
- Create: `tests/session-analytics.test.mjs`

**Step 1: Add failing settings and reporting tests**

Assert fresh runtime settings and admin GET both report `maxFailedLogins: 5`. Assert a
20-minute-old session is absent from `last15min`. Cover null user agents, Android OS,
stable unique-user keys, timestamp-based duration, and `logout` versus `manual` status.

**Step 2: Run and verify failures**

Run: `node --test tests/settings.test.js tests/online-stats.test.mjs tests/session-status.test.mjs tests/session-analytics.test.mjs`
Expected: FAIL on current defaults and calculations.

**Step 3: Implement shared pure helpers**

Move status and analytics calculations out of React components. Merge stored admin
settings over complete defaults. Add missing runtime defaults. Replace hard-coded
15-minute filter labels with neutral Active/Idle labels in every locale.

**Step 4: Run focused tests and build admin**

Run: `node --test tests/settings.test.js tests/online-stats.test.mjs tests/session-status.test.mjs tests/session-analytics.test.mjs && npm run build`
Expected: PASS and successful production bundle.

### Task 7: Full Stability Gate

**Files:**
- Modify: `README.md` only where refresh/cookie/fail-closed behavior needs documenting

**Step 1: Run all tests with coverage**

Run: `node --test --experimental-test-coverage tests/*.test.js tests/*.test.mjs`
Expected: all tests pass; bootstrap/session-controller behavior appears in coverage.

**Step 2: Run package verification**

Run: `npm run build && npm run verify && npm run verify:runtime`
Expected: all commands pass.

**Step 3: Validate publish contents**

Run: `npm pack --dry-run --json`
Expected: no tests, secrets, MMDB files, worktree metadata, or local planning artifacts in
the package.

**Step 4: Inspect repository state**

Run: `git diff --check && git status --short`
Expected: only intentional source, test, documentation, and translation changes.

**Step 5: Commit the implementation**

```bash
git add server admin tests README.md docs/plans
git commit -m "fix: stabilize session lifecycle and Strapi auth integration"
```
