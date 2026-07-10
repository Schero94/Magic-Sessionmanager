# Magic Sessionmanager Security Review

Date: 2026-07-10

## Executive summary

No open critical or high-severity finding was identified in the plugin's
published runtime code. Authentication persistence and token rotation now fail
closed, refresh replay is rejected atomically, all admin routes are protected by
authentication plus plugin RBAC, and outbound webhook hosts are allowlisted.

`npm audit --omit=dev` reports zero known vulnerabilities in production
dependencies. The full development tree reports 33 transitive findings inherited
from Strapi and release/build tooling. npm offers no valid non-breaking Strapi 5
remediation for those findings; they are not bundled as plugin runtime
dependencies.

## Fixed findings

### SEC-01: Tokens could be returned when session persistence failed

Severity: High

Login, password-change and refresh responses now remove JWTs and refresh cookies
and return HTTP 503 when the corresponding session create/rotation cannot commit.
See `server/src/bootstrap.js:405`, `server/src/bootstrap.js:521` and
`server/src/bootstrap.js:772`.

### SEC-02: Concurrent refresh replay could return multiple successful responses

Severity: High

Token rotation uses a conditional `updateMany` against the expected old access or
refresh hash. Exactly one concurrent request can commit. See
`server/src/services/session.js:120` (`rotateSessionTokens`).

### SEC-03: GeoIP provider exceptions bypassed fail-closed firewall policy

Severity: High

The pre-login guard now evaluates thrown lookup failures as `_status: error` and
blocks before authentication whenever the configured policy is fail-closed. See
`server/src/bootstrap.js:213` (`mountPreLoginGeoGuard`).

### SEC-04: Admin route/controller drift was not enforced by CI

Severity: Medium

Every admin route is protected by `admin::isAuthenticatedAdmin` and
`admin::hasPermissions` for `plugin::magic-sessionmanager.access`. A contract test
now verifies both protection and controller-action existence for every admin and
Content API route. See `server/src/routes/admin.js:41` and
`tests/route-contracts.test.js`.

### SEC-05: Remote webhook destinations require strict validation

Severity: Medium

Webhook delivery accepts HTTPS URLs only and restricts hosts to Discord and Slack
allowlists before calling `fetch`. See `server/src/services/notifications.js`
(`sendWebhook`, host validation near `server/src/services/notifications.js:260`).

## Residual risk

### SEC-R01: Development dependency advisories

Severity: Low for the published plugin runtime

The complete development tree currently reports 4 low, 12 moderate and 17 high
transitive advisories. The production-only tree reports zero. Continue tracking
Strapi 5 releases and update when Strapi publishes compatible dependency fixes;
do not apply npm's suggested downgrade to Strapi 4.26.2.

### SEC-R02: In-memory login lockout is process-local

Severity: Low

The failed-login counter resets on restart and is not shared by multiple Strapi
instances. Deployments requiring cluster-wide brute-force protection should add a
Redis- or gateway-backed limiter. This does not weaken JWT/session validation.

## Verification

- 30 concurrent session creations pass without ID/hash collisions.
- 30 users can rotate refresh tokens concurrently.
- Concurrent replay of one old refresh token produces exactly one committed rotation.
- Route/controller/auth policy contract tests pass.
- Production dependency audit: 0 vulnerabilities.
- `npm ci`, tests, production build, Strapi package verification, runtime bundle
  verification and npm pack dry-run pass.
