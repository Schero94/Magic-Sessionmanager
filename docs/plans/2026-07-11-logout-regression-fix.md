# Logout Regression Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore a stable `POST /api/auth/logout` response and synchronize the authenticated plugin session without breaking Strapi authentication or reverting the hardening from `8f32862`.

**Architecture:** Keep Strapi's registered route and move plugin termination to the post-`next()` phase, after Strapi authenticates the request. Delegate ownership-bound token matching and termination to the session service, then normalize successful responses to `{ ok: true, message: "Logged out successfully" }`; handle only Strapi's authenticated legacy-mode 404 as a compatibility success.

**Tech Stack:** Node.js, CommonJS, Strapi v5/Koa middleware, Document Service, `node:test`, `node:assert/strict`.

---

### Task 1: Add ownership-bound session termination

**Files:**
- Modify: `tests/session-service.test.js`
- Modify: `server/src/services/session.js:149-168`

**Step 1: Write the failing service tests**

Add tests proving that authenticated logout:

```js
test('terminateAuthenticatedSession logs out the refresh-token session owned by the user', async () => {
  // Arrange findFirst to require user.documentId, refreshTokenHash and isActive.
  // Return one matching documentId and assert terminateSession receives reason=logout.
  const terminated = await service.terminateAuthenticatedSession({
    userDocumentId: 'user-doc-1',
    refreshToken: 'refresh-token',
  });
  assert.equal(terminated, true);
});

test('terminateAuthenticatedSession falls back to the access token and rejects another user', async () => {
  // Arrange no refresh match and an access-token match only for user-doc-1.
  // Assert no session belonging to user-doc-2 can be selected.
});
```

The mock must inspect the real Document Service filters rather than returning a
session unconditionally.

**Step 2: Run the service tests to verify RED**

Run:

```bash
node --test --test-name-pattern='terminateAuthenticatedSession' tests/session-service.test.js
```

Expected: FAIL because `terminateAuthenticatedSession` does not exist.

**Step 3: Implement the minimal service method**

Add an exported service method with full JSDoc:

```js
/**
 * Terminates the authenticated user's exact session using a refresh token,
 * with an access-token fallback.
 *
 * @param {{userDocumentId: string, refreshToken?: string|null, accessToken?: string|null}} params
 * @returns {Promise<boolean>} Whether an active owned session was terminated
 * @throws {Error} When session lookup or persistence fails
 * @sideeffect Marks one session inactive with logout metadata
 */
async terminateAuthenticatedSession({
  userDocumentId,
  refreshToken = null,
  accessToken = null,
}) {
  if (!userDocumentId) return false;

  const tokenFilters = [];
  if (refreshToken) tokenFilters.push({ refreshTokenHash: hashToken(refreshToken) });
  if (accessToken) tokenFilters.push({ tokenHash: hashToken(accessToken) });
  if (tokenFilters.length === 0) return false;

  const matchingSession = await strapi.documents(SESSION_UID).findFirst({
    filters: {
      user: { documentId: userDocumentId },
      isActive: true,
      $or: tokenFilters,
    },
    fields: ['documentId'],
  });
  if (!matchingSession) return false;

  const { terminatedCount } = await this.terminateSession({
    sessionId: matchingSession.documentId,
    reason: 'logout',
  });
  return terminatedCount === 1;
},
```

Keep `terminateSessionByRefreshToken` for backward compatibility; the logout
interceptor will stop calling it directly.

**Step 4: Run the service tests to verify GREEN**

Run:

```bash
node --test --test-name-pattern='terminateAuthenticatedSession|terminateSessionByRefreshToken' tests/session-service.test.js
```

Expected: PASS.

**Step 5: Commit checkpoint**

Do not commit unless the user explicitly requests it. If requested:

```bash
git add tests/session-service.test.js server/src/services/session.js
git commit -m "fix(session): bind logout termination to authenticated user"
```

### Task 2: Reproduce the real logout middleware ordering

**Files:**
- Modify: `tests/auth-interceptors.test.js:13-94`
- Modify: `tests/auth-interceptors.test.js:189-233`

**Step 1: Upgrade the test harness**

Extend `createContext` so tests can model:

- downstream authentication setting `ctx.state.user`;
- downstream status/body;
- legacy mode configuration;
- session termination occurring before or after downstream authentication.

Do not pre-seed a fake success body as proof of the expected contract.

**Step 2: Write failing regression tests**

Add separate tests:

```js
test('built-in logout authenticates before terminating the plugin session', async () => {
  const events = [];
  // downstream pushes "authenticated"; service pushes "terminated"
  // Expect ["authenticated", "terminated"].
});

test('built-in logout adds the stable message response contract', async () => {
  // downstream returns { ok: true }
  // Expect { ok: true, message: 'Logged out successfully' }.
});

test('bearer-only logout terminates the authenticated current session', async () => {
  // No refresh token; Authorization header is present.
  // Assert service receives accessToken and resolved userDocumentId.
});

test('failed logout authentication does not terminate a plugin session', async () => {
  // downstream returns 401 without ctx.state.user.
  // Assert zero service calls and unchanged 401 body.
});

test('legacy logout converts only the authenticated mode 404 into success', async () => {
  // jwtManagement=legacy-support, downstream sets user then returns 404.
  // Expect termination and stable 200 response.
});
```

**Step 3: Run the interceptor tests to verify RED**

Run:

```bash
node --test --test-name-pattern='logout' tests/auth-interceptors.test.js
```

Expected failures:

- termination occurs before `"authenticated"`;
- `ctx.body.message` is undefined;
- Bearer-only logout does not call the service;
- legacy logout remains 404.

**Step 4: Keep the RED output as evidence**

Confirm failures are assertions about the diagnosed behavior, not fixture or
syntax errors. Do not alter production code until all five tests fail for the
expected reasons.

### Task 3: Refactor logout to post-auth synchronization

**Files:**
- Modify: `server/src/bootstrap.js:833-850`
- Test: `tests/auth-interceptors.test.js`

**Step 1: Capture request credentials without changing state**

At middleware entry, capture:

```js
const refreshToken = getIncomingRefreshToken(ctx, getRefreshCookieName(strapi));
const accessToken = extractBearerToken(ctx);
const jwtMode = strapi.config.get(
  'plugin::users-permissions.jwtManagement',
  'legacy-support'
);
```

Then call `await next()` before any termination.

**Step 2: Gate synchronization on authenticated downstream state**

After `next()`:

```js
const downstreamSuccess = ctx.status >= 200 && ctx.status < 300;
const authenticatedLegacyNotFound =
  jwtMode !== 'refresh' && ctx.status === 404 && !!ctx.state.user;

if (!ctx.state.user || (!downstreamSuccess && !authenticatedLegacyNotFound)) {
  return;
}
```

Resolve the authenticated user's document ID with the existing
`resolveUserDocumentId` helper. If it cannot be resolved, use the existing
fail-closed authentication response and stop.

**Step 3: Terminate the owned plugin session**

Call:

```js
await sessionService.terminateAuthenticatedSession({
  userDocumentId,
  refreshToken,
  accessToken,
});
```

The operation is idempotent: an authenticated logout remains successful when
the plugin session was already inactive or absent.

**Step 4: Restore the response contract**

For successful refresh-mode logout and authenticated legacy compatibility:

```js
ctx.status = 200;
ctx.body = {
  ...(ctx.body && typeof ctx.body === 'object' ? ctx.body : {}),
  ok: true,
  message: 'Logged out successfully',
};
```

Do not modify unauthorized, forbidden, validation, or unrelated 404 responses.

**Step 5: Run the logout tests to verify GREEN**

Run:

```bash
node --test --test-name-pattern='logout' tests/auth-interceptors.test.js
```

Expected: PASS, including order, state synchronization, stable response, legacy
compatibility, Bearer fallback and failed-auth protection.

**Step 6: Commit checkpoint**

Do not commit unless the user explicitly requests it. If requested:

```bash
git add server/src/bootstrap.js tests/auth-interceptors.test.js
git commit -m "fix(auth): synchronize logout after authentication"
```

### Task 4: Verify the complete plugin

**Files:**
- Verify: `server/src/bootstrap.js`
- Verify: `server/src/services/session.js`
- Verify: `tests/auth-interceptors.test.js`
- Verify: `tests/session-service.test.js`

**Step 1: Run focused tests**

```bash
node --test --test-name-pattern='logout|terminateAuthenticatedSession|terminateSessionByRefreshToken' \
  tests/auth-interceptors.test.js tests/session-service.test.js
```

Expected: all focused tests pass.

**Step 2: Run the full unit suite**

```bash
npm test
```

Expected: all tests pass with no failures.

**Step 3: Run build and plugin verification**

```bash
npm run build
npm run verify
npm run verify:runtime
```

Expected: all commands exit 0 and generated bundles contain the post-auth logout
interceptor.

**Step 4: Check diagnostics and diff**

Run IDE lint diagnostics on all modified source/test files, then:

```bash
git diff --check
git status --short
```

Expected: no lint errors introduced, no whitespace errors, and only the intended
source, test and plan files modified.

**Step 5: Optional final commit**

Only when explicitly requested:

```bash
git add \
  docs/plans/2026-07-11-logout-regression-fix-design.md \
  docs/plans/2026-07-11-logout-regression-fix.md \
  server/src/bootstrap.js \
  server/src/services/session.js \
  tests/auth-interceptors.test.js \
  tests/session-service.test.js
git commit -m "fix(auth): restore reliable session logout"
```

