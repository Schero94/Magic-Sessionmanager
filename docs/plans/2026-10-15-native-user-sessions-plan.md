# Magic Sessionmanager native end-user sessions implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Strapi's native Users & Permissions session manager authoritative in `refresh` mode while preserving Magic Sessionmanager's legacy mode, public API contracts, security policies, analytics, and history.

**Architecture:** Add a mode-aware adapter around Strapi's public `strapi.sessionManager('users-permissions')` API. In native refresh mode, Strapi owns token validity and revocation, while Magic session records remain a metadata/history sidecar linked by `nativeSessionId`. In `legacy-support`, retain the existing plugin-owned JWT lifecycle. Existing Magic endpoints stay as compatibility facades over either mode.

**Tech Stack:** Strapi 5.58.0, Node 22, CommonJS server plugin, Strapi Document Service, `node:test`, isolated Strapi test-app, Playwright CLI.

---

## Implementation constraints

- Work only in `plugins/Magic-Sessionmanager`; do not alter the host app's auth configuration, Strapi core, other plugins, or real session data.
- The scope is Users & Permissions end-users. Strapi administrator authentication is explicitly excluded.
- Write failing tests before behavior changes. Preserve existing uncommitted audit changes and do not stage or commit them accidentally.
- Do not issue native refresh tokens from Magic code and do not rotate them twice. For a native mode response that cannot be mirrored safely, revoke the newly issued native session and remove auth tokens from that response.
- Native session operations must use Strapi's public origin-scoped session manager methods. Do not query internal `admin::session` storage directly.
- A configured native refresh mode without a valid `users-permissions` session-manager origin must fail closed with an actionable boot error. Never silently route native tokens through legacy verification.
- Legacy `jwtManagement: 'legacy-support'` remains the default and behavior stays unchanged. Do not migrate or delete old records automatically.
- Use a bounded fan-out when listing sessions across users. A partial native listing failure must not be represented as a complete list.
- The checkout already contains unrelated/uncommitted user changes. The implementation plan file is new; edits to overlapping existing files must preserve those changes.

## Task 1: Define and test the native adapter boundary

**Files:**
- Create: `server/src/utils/native-session-manager.js`
- Test: `tests/native-session-manager.test.js`
- Modify only if needed: `server/src/bootstrap.js`

**Step 1: Write failing adapter tests.** Cover legacy mode selection, native refresh mode selection, native origin unavailable, native manager unavailable, and malformed manager methods. Assert legacy mode does not call native APIs and refresh mode fails closed when the origin is missing.

**Step 2: Run the focused test and confirm it fails for missing adapter behavior.**

Run: `node --test tests/native-session-manager.test.js`

Expected: the new tests fail because the adapter module/API is not implemented.

**Step 3: Implement the adapter.** Detect `jwtManagement` without requiring the Users & Permissions origin during Magic's own bootstrap. Strapi registers that origin in the Users & Permissions bootstrap, which may run later. Resolve/check `hasOrigin('users-permissions')` lazily on native auth/session operations after boot; if still absent, fail closed with an actionable error. Expose only validated public operations needed by the plugin: validate access/refresh tokens, check an access token's native session with `isSessionActive`, list sessions, revoke one session, invalidate user sessions, and expose the mode. Validate the required method before use. Never log tokens or metadata.

**Step 4: Re-run the focused test.**

Run: `node --test tests/native-session-manager.test.js`

Expected: all adapter contract tests pass.

## Task 2: Add the non-destructive native-sidecar link

**Files:**
- Modify: `server/src/content-types/session/schema.json`
- Modify: `server/src/services/session.js`
- Test: `tests/session-service.test.js`
- Test: `tests/native-session-manager.test.js`

**Step 1: Add failing tests.** Verify a native session ID is persisted separately from Magic's existing `sessionId`; refresh rotation updates the native ID and token hashes in one conditional update; legacy records without the new field remain readable; native-mode records do not persist raw tokens while legacy-mode storage behavior remains unchanged.

**Step 2: Implement the optional private native ID field and service parameters.** Preserve existing Magic IDs and make the native reference optional so existing installations require no destructive data migration. Keep existing function signatures backward-compatible by making new parameters optional.

**Step 3: Verify focused regressions.**

Run: `node --test tests/session-service.test.js tests/native-session-manager.test.js`

Expected: existing service coverage remains green and native link/rotation cases pass.

## Task 3: Integrate login, password-change rotation, refresh, and built-in logout hooks

**Files:**
- Modify: `server/src/bootstrap.js`
- Modify if required: `server/src/utils/auth-routes.js`
- Modify if required: `server/src/utils/refresh-token.js`
- Test: `tests/auth-interceptors.test.js`
- Test: `tests/refresh-token.test.js`

**Step 1: Add failing native-mode tests.** Cover login linking to the native session ID returned by `validateRefreshToken`; native refresh validation before and after downstream Strapi rotation; cookie-based refresh; password-change token replacement; no second native token rotation; and compensation on sidecar-write failure.

**Step 2: Preserve the existing legacy middleware tests.** Add native fakes to the harness without changing current legacy expectations. Test that an unsupported native origin fails closed on a native auth/session request after bootstrap rather than accepting untracked tokens. Do not falsely abort Magic startup because the Users & Permissions bootstrap has not run yet.

**Step 3: Implement mode-aware hooks.** In native mode, allow Strapi to perform issuance/rotation/revocation. Magic hooks only validate the before/after native session IDs and update sidecar metadata/token hashes. When a post-rotation sidecar update fails, revoke the new native session, strip access/refresh tokens, and return a failure. After the native Users & Permissions logout has already succeeded, mark the matching Magic sidecar inactive without attempting a second token flow.

**Step 4: Run focused auth tests.**

Run: `node --test tests/auth-interceptors.test.js tests/refresh-token.test.js`

Expected: native lifecycle and legacy lifecycle tests pass; no native generator/rotation method is called by the adapter hooks.

## Task 4: Keep JWT enforcement and last-seen behavior coherent

**Files:**
- Modify: `server/src/bootstrap.js`
- Modify: `server/src/middlewares/last-seen.js`
- Test: `tests/session-aware-jwt.test.js`
- Test: `tests/last-seen.test.js`

**Step 1: Add failing tests.** Verify the native JWT signature check is followed by `isSessionActive`, a deleted/revoked current native session is rejected before Magic accepts it, and rotated ancestors retain Strapi's access-token behavior. Verify plugin block, strict-enforcement, maximum-age, and inactivity checks remain additive for linked sidecars; missing/retired native sidecars are not mistaken for a valid active Magic session in strict mode; and last-seen updates only the matching Magic sidecar without mutating native lifecycle data.

**Step 2: Implement the narrowest changes.** Keep Strapi's native JWT verifier as the first authority, then use the public `isSessionActive(sessionId)` API to detect native revocation. Use native session identity only to match the plugin sidecar. Preserve the current deny-list and strict fail-closed behavior. Do not replace native verification with local JWT decoding or add a different family-wide expiry policy.

**Step 3: Run focused auth enforcement tests.**

Run: `node --test tests/session-aware-jwt.test.js tests/last-seen.test.js tests/session-revocation.test.js`

Expected: native and legacy denial cases pass, including persistent Magic access-token revocation after history deletion.

## Task 5: Adapt service listing, reconciliation, and session actions

**Files:**
- Modify: `server/src/services/session.js`
- Create if useful: `server/src/utils/native-session-view.js`
- Test: `tests/native-session-service.test.js`
- Modify/test: `tests/session-service.test.js`

**Step 1: Add failing service tests.** Cover native sessions with and without a Magic sidecar; reconciliation when a session was revoked through Strapi's Users & Permissions endpoint; active native rows merged with retained Magic history; user-specific listing; legacy-mode results; bounded cross-user listing; and visible failure on incomplete user enumeration.

**Step 2: Add failing operation tests.** Cover single-session termination, user-wide termination, logout-others preserving the current native session, deleting Magic history only after native revocation succeeds, and inactivity cleanup revoking native sessions before marking sidecars inactive. Verify wrong-user session IDs cannot be revoked.

**Step 3: Implement native mapping.** Map native session properties into the existing Magic response shape, leaving unavailable IP/GeoIP/device information explicitly unknown. Keep Magic document IDs stable for sidecar records and use a tagged, URL-safe opaque key encoding the owning user document ID plus native session ID for native-only records. Resolve that row action through the single owner, never a global per-user scan. Reconcile externally revoked native IDs to inactive history without fabricating a termination cause.

**Step 4: Implement cross-user enumeration safely.** Page through Users & Permissions user IDs via Document Service and call public `listSessions` per user with fixed bounded concurrency and a hard result cap. If any user page or native list call fails, surface an error or explicit incomplete result, never a successful complete list.

**Step 5: Run service tests.**

Run: `node --test tests/native-session-service.test.js tests/session-service.test.js`

Expected: the merged native view, lifecycle operations, limits, and legacy behavior pass.

## Task 6: Preserve route contracts and authorization

**Files:**
- Modify only if needed: `server/src/controllers/session.js`
- Modify only if needed: `server/src/routes/content-api.js`
- Modify only if needed: `server/src/routes/admin.js`
- Test: `tests/route-contracts.test.js`
- Test: `tests/session-controller-delete.test.js`
- Test: `tests/native-session-routes.test.js`

**Step 1: Record existing route contracts.** Snapshot paths, methods, policies, response envelopes, and status behavior for native/legacy mode.

**Step 2: Add failing controller/route tests.** Test owner versus other-user behavior for `my-sessions`, own termination and logout flows; test admin permission paths retain admin scope; test native and legacy mode preserve response shape and idempotency responses.

**Step 3: Add only the required delegation.** Keep all existing routes and permissions. Map Magic IDs to native IDs server-side. Use the authenticated user's native ID for content API operations. Do not expose a new unprotected route or weaken existing authorization.

**Step 4: Fix fresh-install permission ordering if the failing regression confirms it.** Strapi registers/initializes the Users & Permissions authenticated role in its plugin bootstrap, which can run after Magic's. If the initial Magic permission setup sees no role, retry the same scoped permission initialization before dispatching the first protected Magic Content API route after all plugin bootstraps. Do not add `auth: false`, public-role access, or weaker ownership checks.

**Step 5: Verify route contracts.**

Run: `node --test tests/route-contracts.test.js tests/session-controller-delete.test.js tests/native-session-routes.test.js`

Expected: route matrix, response-envelope, ownership, and permission tests pass.

## Task 7: Verify UI model and update user documentation

**Files:**
- Modify only if needed: `admin/src/pages/HomePage.jsx`
- Modify only if needed: `admin/src/components/SessionDetailModal.jsx`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Test: `tests/admin-accessibility.test.mjs`
- Test: new tests under `tests/` for native display mapping

**Step 1: Verify existing admin screens consume the stable Magic view model.** Ensure native-only sessions can be opened, exported, and revoked without assuming an IP address or plugin token. Avoid UI changes if the adapter fully preserves the current view model.

**Step 2: Add/adjust tests for labels and optional fields.** Verify an absent IP/device/GeoIP is displayed as unavailable rather than throwing or inventing a value.

**Step 3: Document configuration and compatibility.** Explain that native delegation requires Strapi's `users-permissions.jwtManagement: 'refresh'`, legacy mode remains supported, the plugin does not change host config, Magic routes remain available, and active session state belongs to Strapi in refresh mode. Add a changelog entry and accurate JSDoc on new/changed non-trivial functions.

**Step 4: Run documentation and admin model checks.**

Run: `node --test tests/admin-accessibility.test.mjs tests/native-session-service.test.js`

Expected: existing accessibility checks and native display mapping pass.

## Task 8: Full package quality gates

**Files:** No new source scope. Fix only regressions introduced by Tasks 1-7.

**Step 1: Run the full unit suite.**

Run: `npm test`

Expected: `# fail 0`.

**Step 2: Run type checks and package verification.**

Run: `npm run test:ts:back && npm run test:ts:front && npm run verify && npm run verify:runtime`

Expected: all checks exit 0.

**Step 3: Build the plugin.**

Run: `npm run build`

Expected: plugin build completes and the server bundle verifier remains green.

## Task 9: Local Strapi integration and browser acceptance

**Files:**
- Test evidence under ignored `output/playwright/`
- Update: root `gates/audit-sessionmanager.md` only for this integration's relevant status, preserving existing audit entries

**Step 1: Confirm host/database isolation before runtime actions.** Inspect the live listener command line and `test-app/config/database.ts`; confirm the configured isolated database path before creating any disposable end-user test data. Never print auth headers, credentials, or token values.

**Step 2: Build and boot the shared app.**

Run: `npm run app:build` from the workbench root; then use the existing documented local dev command.

Expected: app build passes, startup log includes every configured plugin key, and Strapi remains on the isolated test DB.

**Step 3: Verify end-user native state with a disposable test user.** Exercise native login, `GET /api/auth/sessions`, `GET /api/magic-sessionmanager/my-sessions`, Magic logout/revoke, native revoke, refresh rotation, and logout-all/logout-others. Compare IDs/statuses and verify a revoked native token is rejected. Do not touch the existing admin test session or real-user data.

**Step 4: Use Playwright CLI on the authenticated Magic admin UI.** Inspect empty/populated states, actions, exports, 1440px and mobile widths, and console/network errors. Do not invoke GeoIP, email, webhook, license, OAuth, or destructive actions on any pre-existing user session.

**Step 5: Verify negative-access behavior.** Confirm anonymous, unauthenticated admin, and unrelated end-user attempts receive the expected 401/403/404 without leaking session data.

**Step 6: Record measured evidence and rerun the goal gates.** Separate package tests, app build/boot, API integration, browser UI, and external-service checks. State any unavailable external-service evidence explicitly.

## Completion criteria

- Both `legacy-support` and native `refresh` modes pass their full test matrices.
- Existing Magic route method/path/policy/response contracts are unchanged.
- Strapi native refresh/revocation is the sole token-validity authority in refresh mode; Magic still enforces its configured additive policies and retains enriched history.
- No code path issues, rotates, or revokes native refresh tokens twice.
- Native revocation through either Strapi or Magic is reflected in both the accepted/rejected token behavior and Magic's session display.
- Plugin unit/type/build/verify gates and shared app build/boot pass; the required safe Playwright and negative-access checks have current evidence.
- No unrelated user changes are lost, overwritten, staged, or committed.
