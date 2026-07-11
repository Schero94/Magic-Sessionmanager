# Logout Regression Fix Design

## Problem

Commit `8f32862` stopped registering the plugin's compatibility handler when
Strapi already exposes `POST /api/auth/logout`. This introduced three coupled
regressions:

1. Strapi's successful response contains `{ "ok": true }` but no `message`.
2. The plugin logout interceptor terminates its session before Strapi
   authenticates the route. The wrapped JWT verifier can therefore reject the
   same request as unauthorized.
3. In `legacy-support` mode Strapi registers the route but intentionally returns
   404, while the plugin no longer supplies its compatibility behavior.

Bearer-only logout can also leave the plugin session active because the current
interceptor only terminates by refresh token.

## Decision

Keep the hardening from `8f32862` and repair only the logout integration. Do not
restore duplicate route registration and do not revert the full stability
change.

The interceptor will capture the incoming access and refresh tokens, call
`next()` without modifying session state, and synchronize the plugin session
only after Strapi has authenticated the request.

## Request Flow

### Refresh mode

1. Capture the incoming refresh token and Bearer token.
2. Call Strapi's route through `next()`.
3. Continue only when Strapi authenticated a user and returned a successful
   response.
4. Terminate the exact plugin session by refresh token. If no refresh token was
   supplied, terminate the session identified by the Bearer token and
   authenticated user.
5. Preserve Strapi's `ok: true` field and add
   `message: "Logged out successfully"`.

### Legacy mode

1. Capture the Bearer token.
2. Call Strapi's registered route so normal authentication still runs.
3. When the authenticated legacy logout handler returns its mode-specific 404,
   terminate the exact plugin session identified by the Bearer token and user.
4. Replace only that expected 404 with the stable success response
   `{ ok: true, message: "Logged out successfully" }`.

### Failed authentication

If Strapi does not authenticate the request, the interceptor must preserve the
downstream error and must not terminate any plugin session.

## Session Service

Token-based termination remains service logic and has no `ctx` dependency.
Refresh-token termination continues to use its atomic hash update. Bearer-token
fallback must bind the access-token hash to the authenticated user's
`documentId` before terminating the session.

No raw request body is passed to the service.

## Error Handling

Expected authentication and mode responses are preserved. Plugin persistence
errors are logged through `strapi.log.error()` and use the existing standardized
authentication failure response; no tokens or PII are logged.

## Response Contract

Successful `POST /api/auth/logout` responses have this stable contract in both
JWT management modes:

```json
{
  "ok": true,
  "message": "Logged out successfully"
}
```

`POST /api/magic-sessionmanager/logout` is unchanged.

## Tests

Implementation follows red-green-refactor. Regression tests must fail before
production code changes and cover:

1. Refresh-cookie logout authenticates before plugin termination.
2. Successful built-in logout adds the stable `message`.
3. The matching plugin session becomes inactive with
   `terminationReason: "logout"` and a non-null `logoutTime`.
4. Bearer-only logout terminates the authenticated user's exact session.
5. Legacy mode converts only the authenticated mode-specific 404 into success.
6. Failed authentication does not terminate any session.
7. A token belonging to another user cannot terminate that user's session.
8. Existing refresh, login, last-seen, and session-service suites remain green.

