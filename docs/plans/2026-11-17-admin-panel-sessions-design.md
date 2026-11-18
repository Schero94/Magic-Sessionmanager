# Admin panel sessions: design

Date: 2026-11-17. Target release: 4.14.0 (minor, additive). Requested by the owner: "see the admins who are signed in to the Strapi admin panel, and be able to sign them out".

## 1. Research (installed Strapi 5.62.0, docs checked 2026-11-17)

Sources: installed `@strapi/core@5.62.0` `dist/services/session-manager.js`, `@strapi/admin@5.62.0` `dist/server/server/src/strategies/admin.js`, `controllers/authentication.js`, `controllers/authenticated-session.js`, `routes/users.js`, `bootstrap.js`, `content-types/session.js`, `shared/utils/session-auth.js`, `@strapi/utils@5.62.0` `dist/sessions.js`; docs https://docs.strapi.io/cms/configurations/admin-panel (Session management) and Context7 `/strapi/documentation`.

| Question                                                          | Answer (5.62.0)                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where are admin sessions stored?                                  | `admin::session` (`strapi_sessions`), shared with Users & Permissions refresh mode. Admin rows have `origin = 'admin'`. Fields: `userId` (string admin id), `sessionId`, `deviceId` (required), `childId`, `type` (`refresh` = "remember me", `session` = browser session), `status` (`active`, `rotated`), `metadata` (`{ loginAt, deviceName }`), `expiresAt`, `absoluteExpiresAt`, `createdAt`. No IP address and no raw user agent are stored. |
| What is one "signed-in browser"?                                  | One `deviceId`. Every access-token renewal (`POST /admin/access-token`) rotates the refresh record: the old row becomes `rotated` (`childId` set), a new `active` row is created. `createdAt` of the active row is Strapi's own "last active" signal (`sanitizeSessionEntry`).                                                                                                                                                                     |
| Access token lifespan                                             | `admin.auth.sessions.accessTokenLifespan`, default 1800 s (30 min). Session idle 7200 s (2 h), max 30 days; refresh ("remember me") idle 14 days, max 30 days.                                                                                                                                                                                                                                                                                     |
| Does a revoked admin keep working until the access token expires? | **No.** `strategies/admin.js` calls `sessionManager('admin').isSessionActive(payload.sessionId)` on **every** admin API request. `isSessionActive` returns false when the row is gone. Deleting the rows ends the admin's next request with 401; the panel then fails to renew (`rotateRefreshToken` finds no row) and shows the login page.                                                                                                       |
| Pitfall                                                           | `isSessionActive` does not check `status`. An older access token whose row is now `rotated` stays valid until that token's `exp` (up to `accessTokenLifespan`) if only the `active` row is deleted (`revokeSessionById`). So the plugin deletes **every row of the device** (`invalidateRefreshToken(userId, deviceId)`, the same call Strapi's own logout makes). Then no access token of that browser survives.                                  |
| "Sign out everywhere"                                             | `invalidateRefreshToken(userId)` deletes every admin row of that admin (Strapi logout without deviceId does the same).                                                                                                                                                                                                                                                                                                                             |
| Last sign-in                                                      | Strapi stores no "last login" on `admin::user`. `metadata.loginAt` exists only while a session row exists. The view shows "Not signed in" without a date.                                                                                                                                                                                                                                                                                          |
| Strapi's own UI                                                   | 5.62 has `GET/DELETE /admin/users/me/sessions` for the signed-in admin's **own** sessions only. Nothing lists or ends other admins' sessions.                                                                                                                                                                                                                                                                                                      |
| Admin API tokens                                                  | `admin-token` strategy, independent of sessions. Signing out does not revoke admin API tokens; the docs and dialog say so.                                                                                                                                                                                                                                                                                                                         |

## 2. Current state

- Dashboard, widget, Analytics and the side panel cover Users & Permissions sessions only. The dashboard subtitle says "Strapi administrators are not listed."
- `countNativeOnly` (4.13.0) filters `origin = 'users-permissions'`, so admin rows never enter end-user numbers. This must stay so (regression tests added).
- RBAC: one action `plugin::magic-sessionmanager.access`.

## 3. Target state

### 3.1 IA

- The plugin page gets a two-item view switch below the header: **App users** (existing dashboard, unchanged) and **Admin panel** (new route `plugins/magic-sessionmanager/admin-panel`). The switch is a `nav` with two links (`aria-current="page"`), shown only to admins who may read admin sessions. Admin numbers never appear on the App users view and vice versa.
- Question the Admin panel view answers: "Who can use this admin panel, who is signed in right now, and how do I sign someone out?"
- Glossary: **Admin** (Strapi admin account), **Signed in** (has at least one live admin session), **Session** (one signed-in browser), **Sign out** (end one session), **Sign out everywhere** (end all sessions of one admin). "End" stays reserved for app-user sessions, "Deactivate" belongs to Strapi's Settings > Users.

### 3.2 Screen

1. Header: title "Admin panel sessions", subtitle "Who is signed in to this Strapi admin panel. Your app's users are under App users."
2. View switch.
3. Three stat cards (count-only, never mixed with user numbers): **Signed-in admins**, **Admin sessions** (signed-in browsers), **Active admin accounts**. Clicking a card filters the list.
4. Info card: "Signing out takes effect on the admin's next click: Strapi checks the session on every admin request. They can sign in again with their password. To stop someone from signing in, deactivate them in Settings > Users." plus link to `/settings/users`. Also states that admin API tokens are not affected and that Strapi records no IP address for admin sessions.
5. Toolbar: search (name or email), filter (All admins, Signed in, Not signed in), Refresh.
6. List: table at >= medium, cards below. Columns: Admin (name, email, "You" badge), Roles, Status (Signed in · N sessions / Not signed in / Deactivated / Invited), Last active, Actions (View sessions, Sign out everywhere). Pagination (10/25/50/100), state in the URL.
7. Sessions dialog per admin: one row per browser: device ("Chrome on macOS" from Strapi, or "Unknown browser"), signed in, last active, ends at the latest (idle/absolute expiry), "Remember me" badge, "This browser" badge. Action: Sign out. Footer: Sign out everywhere, link "Manage in Settings > Users".

States: first load (`Page.Loading`-style loader), refresh (inline, list stays mounted), empty (only happens when filter/search excludes everyone: "No admins match your search or filter." + Clear filters), error ("Admin sessions could not be loaded." + Try again, last data kept on refresh), no permission (`Page.NoPermissions` on the route; switch hidden), unsupported host (`strapi.sessionManager` missing: explanation, no actions).

### 3.3 Actions and foot-guns

| Action                          | Dialog title                  | Body                                                                                                                                                        | Confirm             |
| ------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Sign out one session            | "Sign out of this browser?"   | "{name} is signed out of {device} on their next click in the admin panel. They can sign in again with their password."                                      | Sign out            |
| Sign out everywhere             | "Sign out {name} everywhere?" | "All {count} sessions end on {name}'s next click. They can sign in again with their password. To block access, deactivate the account in Settings > Users." | Sign out everywhere |
| Self (current browser included) | "Sign yourself out?"          | warning alert: "This includes this browser. You will be taken to the login page."                                                                           | Sign out            |

Guards (server-side, mirrored in the UI with a disabled button and a reason):

- **Super Admins are protected from delegated roles.** An actor without the Super Admin role cannot sign out a Super Admin (403). This also guarantees the last active Super Admin can never be signed out by someone else. A Super Admin may sign themselves out (warning shown).
- Revoke requires a person in the browser (`ctx.state.auth.strategy.name === 'admin'`); admin API tokens get 403.
- No action on deactivated or invited accounts (Strapi already rejects their requests); Settings > Users link instead.

### 3.4 API (admin router, prefix `/magic-sessionmanager`)

| Method, path                                                        | Policies                                                               | Rate limit   | Response                                                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `GET /admin-sessions/admins?page&pageSize&search&filter`            | `isAuthenticatedAdmin`, `hasPermissions [access, admin-sessions.read]` | read 120/min | `{ data: AdminRow[], meta: { pagination, stats, policy, viewer } }`                                             |
| `GET /admin-sessions/admins/:adminId/sessions`                      | same                                                                   | read         | `{ data: SessionRow[], meta: { admin } }`; 404 for unknown admin                                                |
| `POST /admin-sessions/admins/:adminId/sessions/:sessionId/sign-out` | `[access, admin-sessions.read, admin-sessions.revoke]`                 | write 10/min | `{ data: { ended, signedOutSelf } }`; 404 unknown admin or session (also "session of another admin"); 403 guard |
| `POST /admin-sessions/admins/:adminId/sign-out-everywhere`          | same                                                                   | write 10/min | `{ data: { ended, signedOutSelf } }`                                                                            |

- `AdminRow`: `{ id, name, email, roles: [{ name, superAdmin }], account: 'active'|'deactivated'|'invited', self, sessionCount, lastActiveAt, canSignOut, protectedReason }`.
- `SessionRow`: `{ id (sessionId of the newest active row), device, signedInAt, lastActiveAt, endsAt, rememberMe, current }`. Never tokens, `deviceId`, `childId`, hashes or numeric row ids.
- Validation: zod strict query (page 1..1e6, pageSize 1..100, search <= 100, filter enum), `adminId` `^[0-9]{1,12}$`, `sessionId` `^[a-f0-9]{32}$` (Strapi's `randomBytes(16).hex`). 400 with field errors.
- Audit: `strapi.log.info('[magic-sessionmanager] admin sign-out', { actorId, targetId, scope, ended })` (admin numeric ids only, no email, no session id, no token). Also `strapi.eventHub.emit('magic-sessionmanager.admin-sessions.signed-out', same payload)` for hosts that forward audit events.
- Unsupported host (no `strapi.sessionManager`, no `admin` origin): GET returns `meta.supported = false` and empty data; POST returns 503 "Admin session management is not available on this Strapi version.".
- RBAC actions `admin-sessions.read` ("Read admin panel sessions") and `admin-sessions.revoke` ("Sign out admins"), subCategory "Admin panel". Strapi grants every registered action to Super Admin at boot; other roles get nothing until granted.

### 3.5 Click paths (from the plugin entry page)

| Task                          | Steps                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------- |
| See who is signed in          | 1: Admin panel                                                                |
| Sign out one admin everywhere | 1: Admin panel, 2: Sign out everywhere (row), + confirm                       |
| Sign out one browser          | 1: Admin panel, 2: View sessions, 3: Sign out, + confirm                      |
| Find an admin                 | 1: Admin panel, 2: type in search                                             |
| Deactivate an admin           | 1: Admin panel, 2: View sessions, 3: Manage in Settings > Users (Strapi page) |

## 4. Non-goals

- No storage of admin IPs, user agents or login history; the plugin reads what Strapi stores.
- No deactivation, role change or password reset (Strapi's Settings > Users does that).
- No change to App users routes, numbers, widget, side panel, settings or content-API features.

## 5. Tests

- Unit: query parsing, grouping by device, status mapping, guards, DTO allowlist (no token/hash/deviceId), audit log content, route policy matrix.
- Regression: dashboard stats, widget user stats and untracked-session counts unchanged with admin rows present.
- Integration (real Strapi 5.62.0, SQLite and PostgreSQL): admins signed in through `POST /admin/login`; list, sign out one, sign out everywhere, self sign-out flag, Super Admin guard, RBAC denial for an Editor and for a role with read only, access token rejected on the next request, refresh (`POST /admin/access-token`) rejected, old access token of a rotated row rejected.
- Browser acceptance on an isolated 5.62.0 host from the packed tarball.
