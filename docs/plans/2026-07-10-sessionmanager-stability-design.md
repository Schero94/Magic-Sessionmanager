# Session Manager Stability Design

## Goal

Make Magic Session Manager reliable enough for a stable release by fixing the
confirmed session-lifecycle, Strapi 5.50 authentication, GeoIP, notification,
bulk-operation, and admin-reporting defects without breaking the plugin's
public endpoints.

## Compatibility

- Keep the existing Session content type and public plugin routes.
- Support Strapi 5 legacy JWT mode and Strapi 5.50 refresh-session mode.
- Support refresh tokens supplied in the JSON body or Strapi's HttpOnly cookie.
- Preserve existing inactive-session records and termination reasons.

## Session Lifecycle

The global last-seen middleware will run the downstream Strapi route first so
route authentication can populate `ctx.state.user`. After a successful
authenticated request, it will locate the exact session by token hash and touch
that session. Self-terminating routes remain excluded from the post-response
touch.

JWT verification will enforce maximum age, inactive state, and inactivity in a
single order. An active database row whose last activity exceeds the configured
timeout is terminated immediately with reason `idle`; it is not accepted until
the periodic cleanup runs. Legacy inactive rows without a reason may only be
reactivated while still inside the inactivity window.

## Authentication Integration

A shared classifier will define every endpoint that can issue a new JWT. The
pre-login GeoIP guard and post-auth session persistence will use that classifier
with explicit handling for routes that require an already authenticated user,
such as `change-password`.

Session persistence is fail-closed. If a login, password change, or refresh
returns a JWT but the corresponding session state cannot be created or rotated,
the middleware replaces the response with HTTP 503. This prevents valid but
untracked credentials from leaving the server.

Refresh rotation will be serialized per old refresh-token hash. After acquiring
the lock, a request re-checks that the old token still belongs to an active
plugin session. Only one concurrent rotation can succeed. Body tokens and
Strapi's configured HttpOnly refresh cookie are supported. Password changes
rotate the current plugin session to the newly returned credentials instead of
creating an unrelated duplicate session.

## Data Operations

Bulk termination will repeatedly fetch bounded batches until no matching active
sessions remain. It will stop after repeated no-progress batches to avoid an
infinite loop on persistent database failures. The user-block lifecycle will use
the session service rather than maintaining a second capped implementation.

The configured default settings will be the single runtime source of truth. The
admin defaults and runtime defaults will agree, including failed-login lockout.

## GeoIP And Notifications

When geolocation is disabled and neither geofencing nor suspicious-session
blocking requires a lookup, session enhancement will not perform or persist a
GeoIP lookup. Security enforcement that explicitly depends on GeoIP remains
able to request a lookup.

The VPN/Proxy alert setting will only control notification delivery. It will no
longer alter firewall blocking semantics. The existing VPN/Proxy email template
and service method will be called when the matching alert is enabled.

## Admin Reporting

Admin session status will derive from `terminationReason`, with a legacy
fallback for old rows. Analytics will tolerate missing user agents, classify
Android correctly, calculate session duration from timestamps, and use stable
user identifiers. Online-stat buckets will not count a 15-to-30-minute session
inside the 15-minute bucket. Labels will not hard-code a timeout that may differ
from the configured value.

## Testing

Regression tests will cover:

- realistic middleware ordering where Strapi authenticates during `next()`;
- per-request inactivity enforcement;
- body and HttpOnly-cookie refresh rotation;
- concurrent refresh-token reuse;
- password-change token rotation;
- fail-closed persistence failures;
- more than 1,000 sessions in bulk operations;
- disabled GeoIP behavior;
- VPN/Proxy alert delivery and firewall independence;
- admin status and analytics helpers;
- synchronized runtime and admin defaults.

The final gate is the complete test suite, production build, Strapi package
verification, server-bundle runtime verification, and a clean publish manifest.
