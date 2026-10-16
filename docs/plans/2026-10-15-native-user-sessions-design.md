# Native Users & Permissions session integration

**Status:** Approved for implementation on 2026-10-15
**Scope:** Strapi Users & Permissions end-user sessions only. Strapi administrator sessions are out of scope.

## Goal

Use Strapi's native session manager as the authority for end-user session validity and revocation when Users & Permissions runs in `jwtManagement: 'refresh'` mode. Keep Magic Sessionmanager's existing API contract, legacy JWT mode, security checks, enriched session history, and administration UI behavior.

## Evidence and compatibility baseline

- The local integration host pins Strapi `5.58.0`; `npm view @strapi/strapi@5 version` also reports `5.58.0` as the newest published Strapi 5 version checked on 2026-10-15.
- The local host configures Users & Permissions with `jwtManagement: 'refresh'` and `sessions.httpOnly: true`.
- Strapi 5.58.0 runs plugin bootstrap lifecycles in registered module order, and Users & Permissions defines its native session origin during its own bootstrap. Since Magic may bootstrap first, the plugin must not require `hasOrigin('users-permissions')` during its own bootstrap. Resolve/check the origin lazily on auth and session operations, which run only after Strapi has completed plugin bootstrapping; if it is still missing then, fail the request closed.
- Strapi's installed `@strapi/core` session manager is exposed as `strapi.sessionManager`. The Users & Permissions plugin registers the `users-permissions` origin. Its origin-scoped public methods include `validateAccessToken`, `validateRefreshToken`, `isSessionActive`, `listSessions`, `revokeSessionById`, and `invalidateRefreshToken`.
- In the installed Strapi 5.58.0 source, `validateAccessToken` checks the JWT signature and token type but does not check whether its session row still exists. The integration must follow it with `isSessionActive(sessionId)` so revoking the current native session also rejects its still-unexpired access token. Access tokens from rotated ancestors retain Strapi's short-lived access-token behavior; the plugin must not invent a different refresh-family policy.
- `listSessions(userId)` lists active sessions for one end-user and origin. There is no public global list method, so the Magic admin dashboard must aggregate over paged Users & Permissions users with bounded concurrency. The implementation must not read or write Strapi's internal `admin::session` table directly.
- Magic Sessionmanager currently intercepts Users & Permissions login, refresh, and logout flows and stores enriched history in `plugin::magic-sessionmanager.session`. It uses access/refresh token hashes for lookups and strict session checks, and currently stores encrypted tokens as well. Those hooks must not perform a second native token rotation.
- Context7 documentation lookup was attempted, but its monthly quota was exhausted. The API surface above was checked against the pinned Strapi 5.58.0 installed source and the official [Users & Permissions REST API documentation](https://docs.strapi.io/cms/features/users-permissions/rest-api) and [session configuration documentation](https://docs.strapi.io/cms/configurations/admin-panel#session-management).

## Approaches considered

1. **Mode-aware native adapter with Magic metadata sidecar (selected).** In `refresh` mode, delegate native validation, listing, rotation, and revocation to Strapi. Keep Magic's enriched history and policy state in its own content type. In `legacy-support`, retain current plugin-owned behavior. This preserves both application modes while giving refresh-mode tokens one authoritative session store.
2. **Dual-write and dual-revoke in both stores.** This retains the current layout but creates split-brain failure cases: one store may accept or revoke a session while the other disagrees. It also duplicates native refresh-token rotation. Rejected.
3. **Force all applications into native refresh mode.** This would change authentication semantics for existing consumers and require a global migration outside the plugin's authority. Rejected.

## Architecture and data flow

### Mode selection

- Read `plugin::users-permissions.jwtManagement`, defaulting to `legacy-support` as Strapi does.
- In `legacy-support`, keep existing plugin JWT hooks and session service behavior.
- In `refresh`, use the native `users-permissions` session manager. Verify the manager exists and check `hasOrigin('users-permissions')` lazily when a native operation runs, after plugin bootstrapping. If refresh mode is configured but the API/origin is still unavailable then, fail that auth/session request closed with an actionable error. Never silently fall back to plugin-only JWT validation in a mode that issued native tokens.
- Do not mutate the host application's Users & Permissions configuration or migrate/delete old session records automatically.

### Session ownership and retained metadata

- Strapi owns active refresh-token session families and token validity in `refresh` mode. The adapter uses only the origin-scoped session-manager methods; it does not generate or rotate a second token family. After Strapi verifies an access token, Magic also checks that token's native session ID with `isSessionActive` because signature validation alone does not establish that the native session still exists.
- Magic's session content type remains the metadata/history sidecar for IP, device, geolocation, security score, plugin inactivity rules, and historical reporting.
- Preserve the existing Magic `sessionId` and `documentId` semantics for old consumers. Add an optional `nativeSessionId` field to link a sidecar to the current Strapi session-family member. The native identifier changes during refresh rotation, so update it atomically with Magic's access/refresh token hashes and `lastActive`.
- In native mode, store only token hashes in Magic records where possible; do not duplicate raw native access or refresh tokens in the plugin. Legacy-mode storage remains unchanged for backwards compatibility.
- Native sessions that predate the sidecar can still be listed as minimal rows from Strapi's `listSessions` result. Preserve established Magic row shapes and use an explicit native row key for actions. Missing optional IP, GeoIP, or device details must be represented as unavailable, not fabricated.
- Reconcile sidecars against native active session IDs when listing. A native session revoked through Strapi's own Users & Permissions API must not remain displayed as active in Magic. Retain its existing Magic history.

### Existing plugin endpoints and operations

- Keep every existing route, method, authentication requirement, permission, and response envelope.
- Own-session listing and single-session termination map to `listSessions` and `revokeSessionById`, with the authenticated Users & Permissions numeric user ID as the native owner key.
- Logout and logout-all map to native revocation. Logout-others enumerates the caller's native sessions and revokes all except the current native session ID. Preserve the current fallback behavior and response flags for callers without a match.
- Magic admin listing aggregates active native sessions across paged end-users with bounded concurrency and merges the results with retained Magic history. Do not imply an unbounded complete list when an existing plugin cap is reached; expose truncation metadata if required by the established response contract.
- Admin termination, user-wide termination, deletion, and inactivity cleanup must revoke a linked native session before marking/deleting its sidecar. If native revocation fails, leave the sidecar intact and active state unchanged. Hard delete and retention must never bypass native revocation or the existing access-token deny-list guarantees.
- Login and refresh middleware record metadata and synchronize the current native session ID only after Strapi's own auth operation succeeds. On sidecar synchronization failure after native rotation, revoke the newly issued native session and strip auth tokens from the response so no untracked session is returned.
- The JWT verification wrapper remains layered after Strapi's native cryptographic verification, then checks `isSessionActive` for the token's native session ID. Magic's block, strict-enforcement, maximum-age, and inactivity policies remain additive for tracked sidecars. Previously rotated ancestor access tokens keep Strapi's short-lived access-token semantics; do not add an incompatible family-wide access-token revocation policy.
- Last-seen updates continue using the authenticated access-token hash and update the matching sidecar. They must not alter native session lifecycle state.

## Failure and security behavior

- Native manager exceptions on an auth or revocation path fail closed. They must not be converted into successful logout, fallback acceptance, or a `terminated` sidecar state.
- Preserve current route-level authentication, ownership checks, and rate limits. Native `revokeSessionById` must always receive the target user's ID and the requested session ID; user-facing paths may revoke only the authenticated user's sessions.
- Do not log credentials, raw access/refresh tokens, full IP addresses, or full native token payloads.
- Native user enumeration is paged. Cross-user native listing uses a fixed small concurrency limit and bounded total results. A partial per-user failure must be visible rather than reported as a complete result.
- External GeoIP, mail, webhook, license, or OAuth calls are not part of tests or local acceptance.

## Verification

1. Add failing unit/regression tests before source changes for native mode, legacy mode, native token rotation, external native revocation reconciliation, own/other-user ownership, logout-all/logout-others, admin actions, stale sidecar handling, failure compensation, and unchanged route response envelopes.
2. Run the plugin's complete `npm test`, front/back type checks, `npm run verify`, `npm run build`, and `npm run verify:runtime`.
3. Use the local Strapi 5.58.0 host with its already configured refresh mode and a disposable end-user session. Verify the native Users & Permissions session list and Magic list/revoke/logout flows agree. Do not alter or revoke the pre-existing test admin or any real user's sessions.
4. Run `npm run app:build`, boot the local app, confirm all configured plugin keys in startup logs, and use the Playwright CLI to verify the Magic admin session list and safe UI states. Test anonymous/unauthorized route denials separately. No outgoing provider actions or destructive use of real session data.
5. Document the mode requirements and preserved legacy behavior in the plugin README and changelog.

## Rollback boundary

Rollback consists of reverting the plugin code only. The integration does not rewrite Users & Permissions configuration, native session records, or legacy session records. Native sessions remain owned and validated by Strapi. Do not push or publish without separate user authorization.
