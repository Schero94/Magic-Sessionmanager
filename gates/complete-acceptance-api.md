# Endpoint and security acceptance

Scope: all current plugin admin, content and compatibility routes; no production data or external provider operations.

## Current state on the redesign branch, 2026-11-06 (read first)

Strapi version of every HTTP count (GA-08): sections below this one ran on the workbench test-app, **Strapi 5.58.0**, unless they say otherwise. The plugin targets 5.61.0 (`package.json` devDependency). The runs in this section used `SESSION_HTTP_STRAPI_NODE_MODULES` pointing at `.tmp/sessionmanager-complete-host/node_modules` (`@strapi/strapi` **5.61.0**), on the redesign working tree around 17:40:

| Command | Result |
| --- | --- |
| `SESSION_HTTP_MODE=legacy-support node --test tests/isolated-http-access.test.js` | 38 tests, 38 pass |
| `SESSION_HTTP_MODE=refresh node --test tests/isolated-http-access.test.js` | 40 tests, 40 pass |
| `SESSION_HTTP_MODE=refresh SESSION_HTTP_FALLBACK=1 node --test tests/isolated-http-access.test.js` | 41 tests, 41 pass |
| `SESSION_HTTP_FALLBACK=1 node --test tests/isolated-http-access.test.js` (legacy) | 39 tests, 39 pass |
| `node --test tests/isolated-fallback-logout-http.test.js tests/isolated-http-portability.test.js` | 5 tests, 5 pass |
| server focused (`server-api-hardening`, `auth-routes`, `settings`, `license-controller`, `geoip-controller`, `endpoint-error-contracts`, `route-contracts`, `content-api-permissions`, `session-controller-delete`, `native-session-routes`, `session-policy`) | 98 tests, 98 pass |

The default without `SESSION_HTTP_STRAPI_NODE_MODULES` is still the 5.58.0 test-app; acceptance evidence must name the 5.61 host explicitly.

New regression coverage on this branch (server agent): every Content API route answers 429 once its per-caller budget is spent, with buckets keyed on the matched route template instead of the raw path (API-1/API-2); admin settings can only tighten the write limit (API-5); a partial settings PUT keeps omitted fields and rejects invalid values with 400 instead of clamping (API-6); a successful password reset ends older sessions in both modes (GA-04); a foreign session id on `DELETE /my-sessions/:id` answers like an absent one (API-10); admin session lists drop the internal `sessionId` (F12); a bodyless `toggle-block` keeps the pre-4.9 toggle (GA-09/API-4, see next section). Store and provider failures now answer 500 (502 for the MaxMind download, 503 for an unreachable license server) instead of 400 (API-7); the `{ data: null, error }` envelope is unchanged, but the status codes differ, so clients that branch on 400 see a change.

A2 stays open: races and partial writes, fallback-route rate limiting, current-session 202/404 over HTTP, other malformed IDs, DB failures in more places, multi-process and non-SQLite databases. These runs are green tests, not a security sign-off.

Opt-in policy (API-11), 2026-11-06: no plugin route attaches `plugin::magic-sessionmanager.session-required`; revocation is enforced for every Users & Permissions request by the JWT wrapper. The README section "Optional route policy: `session-required`" states how a project attaches it (`config.policies` of its own routes) and what it checks in strict and relaxed mode. `tests/readme-session-policy.test.mjs` pins the registered name, the documented cases and that no plugin route uses it; `tests/session-policy.test.js` and `tests/server-api-hardening.test.js` ("API-11") cover the behaviour.

Status codes in the route table below (GA-12): the license, GeoIP and settings rows were measured on 4.8.0 (400 for every server-side failure). On the redesign branch they are 500/502/503 (API-7); the rows now name both. The other rows are unchanged.

## Retry-safe contract implementation, 2026-11-06

Superseded in part on the redesign branch (GA-09/API-4): bodyless requests are **no longer** rejected. A request without `blocked` keeps the pre-4.9 toggle behaviour (deprecated, response `mode: 'toggle'`); `{ blocked: true | false }` sets the state retry-safely (`mode: 'explicit'`); a `blocked` value that is present but not boolean is still a 400 before any mutation. The README toggle-block section was corrected on 2026-11-06 and now describes this contract (explicit state recommended, bodyless toggle deprecated, additive `mode`). The text below describes the acceptance worktree.

The explicitly approved breaking contract now requires `{ blocked: true | false }` on `POST /user/:userId/toggle-block`; bodyless and non-boolean requests return 400 before mutation. The admin panel sends the state chosen at confirmation. Block requests invoke revocation even when the user was already blocked, so a sequential retry following partial revocation or a lost success response no longer reverses the block. Explicit unblock remains available. The README documents the migration and partial-effect limits. The historical characterization below predates this change and must not be read as the current implementation.

Before implementation, new isolated HTTP assertions failed in both modes: repeated block returned false and a bodyless request returned 200. After implementation the complete isolated HTTP suite passed 32 tests in legacy-support and 34 in refresh, on disposable SQLite hosts with synthetic users and network guard. The full Node suite passed 416 tests with zero skips; frontend and backend type checks passed. Tests borrowed an existing dependency directory through a temporary symlink which was removed afterward. `git diff --check` passed. No actual sessions or external provider were used.

These results do not prove serialization of conflicting simultaneous requests, multi-process or multi-database behavior, crash recovery, direct user updates through other Strapi routes, a rebuilt bundle or a browser test of the new request. Revocation can partially complete before a 500. A2 and the integration/release gates remain open.

### Controlled conflicting-request observation

A deterministic real-host HTTP test now holds the original block request at its second session-revocation call, after the user has been written as blocked. While held, a separate explicit unblock returns 200 and commits `blocked: false`. When released, the earlier block request also returns 200 with `blocked: true`, even though the persisted user is unblocked. The synthetic session was inactive in this interleaving. The response reflects the earlier request's intended state, not the eventual persisted state; an admin client relying on it can display stale status. The test intentionally characterizes this ordering, not a security fix, and uses one SQLite process, not multiple workers or production databases. Runs passed 33 tests in legacy-support and 35 in refresh. Opposing requests remain unserialized and this observation must not be read as general proof about other interleavings.

## Pre-change contract

### Isolated HTTP continuation

Create an executable endpoint-specific Node test that starts a disposable Strapi host on an OS-assigned loopback port, with a newly created SQLite database, synthetic principals and the current plugin source. Deny external network and provider operations. Exercise the actual Strapi authentication/authorization pipeline and handler ownership, not a substitute router. Each test run creates fresh data and tears down only its own host and temporary directory. Report per-route results and keep untested cases open. No install, build, existing host, existing sessions or shared dependency changes.

### HTTP edge-case continuation

### Concurrency and partial-failure continuation

Use deterministic barriers and narrowly injected failures in disposable Strapi HTTP hosts; verify reported status against persisted synthetic session/revocation state and preserve unrelated records. An operation must not claim full termination after a session update failed. Fallback registration will be explored only with isolated host configuration; no installed package or production path is modified. All behavioral fixes require a failing regression first, and non-atomic operations will be reported explicitly.

Exercise missing or malformed resource IDs without modifying unrelated records, and inject representative database, plugin-store, service and provider exceptions through live HTTP handlers. Check stable statuses and response redaction, restoring all injected functions after each case. The legacy fallback logout is tested separately over loopback with its actual registered handler and synthetic JWT/service dependencies; this is not evidence of Strapi route registration or middleware integration.

### Approved 404 correction

`POST /sessions/:sessionId/terminate` returns the existing Strapi 404 envelope for an absent Magic or native target. `POST /user/:userId/terminate-all` returns it for an absent Users & Permissions user, whether the path contains a numeric ID or a document ID. Existing sessions, native-only sessions and existing users with zero active sessions keep their successful response contracts. Database failures stay 500, not 404; absent targets must not cause revocation or unrelated mutations. Add and run isolated HTTP regressions in both JWT modes before implementation.

Evidence: before implementation the independent HTTP regressions returned 200 for missing Magic sessions in both modes, 200/500 for missing document users in legacy/refresh, 200 for missing numeric users, and 200 for a missing native key. After the controller correction, the legacy host passed 18 tests and the refresh host passed 20 tests. The tests assert 404 envelopes, unchanged unrelated session state and, in refresh mode, unchanged native-session activity. Existing active sidecar termination, existing user-wide termination, empty users by numeric/document ID and native-only termination retain 200; a simulated user database failure remains a sanitized 500. Full Node suite: 392 passed, 0 failed, 0 skipped; it includes the legacy host, while refresh was run separately. No session service, GeoIP or settings-loader code changed for this correction.

The admin UI and its controls are outside this leaf; they consume the existing admin and Content API routes. Admin routes require both authenticated admin and `plugin::magic-sessionmanager.access`. Content routes require Users & Permissions and enforce ownership; the current session must be revoked through logout, not the other-session action. Responses retain their existing envelopes and legacy/native paths. No services, UI, external providers or real users are changed. Test doubles establish controller behavior but do not establish that a running Strapi host enforces its policies.

Initial concern: native linked sidecars may identify the current session by native ID even when their stored access-token hash differs from the request token. A current-session revoke must return the existing 400 response and must not call termination. First reproduce this using a fake document and service, then change only the controller if confirmed.

License creation also must reject non-string or whitespace-only identity fields with its existing 400 envelope before invoking the provider. Valid inputs and provider results remain unchanged.

The opt-in session policy must reject an authenticated request when strict enforcement is configured but its user identity or session lookup cannot be verified; relaxed mode retains its existing fail-open compatibility. Use the existing UnauthorizedError message and do not expose exceptions.

- [x] A1: Inventory every registered endpoint and its handlers, policies, authentication and response contract, including development and native/legacy branches.
  EVIDENCE: route matrix below; `tests/route-contracts.test.js` checks every declared plugin route and policy; `tests/auth-interceptors.test.js` exercises the separate compatibility route.
- [ ] A2: For each applicable endpoint verify authorized success, anonymous and wrong-role rejection, wrong owner, invalid input, provider failure and safe errors. Document executable evidence and gaps explicitly.
  EVIDENCE: pending
- [ ] A3: Confirmed endpoint/security defects are fixed with a failing regression first; existing public contracts stay compatible.
  EVIDENCE: Unchecked 2026-11-06 (GA-04, API-4). On the acceptance worktree the claim did not hold: the confirmed password-reset defect was open and the bodyless toggle-block had been made a breaking 400. On the redesign branch the reset defect is fixed and the bodyless toggle is compatible again (see top section), but server-side store/provider failures now answer 500/502/503 instead of 400; that client-visible change needs a release decision before this gate can close. Earlier evidence still holds: the native current-session, malformed license identity, and strict opt-in policy regressions failed before their respective edits and pass afterwards.
- [x] A4: Focused endpoint/security suite passes after changes, and no secrets or personal data appear in tests or reports.
  EVIDENCE: `node --test --test-reporter=spec tests/endpoint-error-contracts.test.js tests/route-contracts.test.js tests/ownership-permissions.test.js tests/native-session-routes.test.js tests/session-policy.test.js tests/session-controller-delete.test.js tests/license-controller.test.js tests/geoip-controller.test.js tests/settings.test.js tests/content-api-permissions.test.js tests/session-revocation.test.js tests/auth-routes.test.js tests/auth-interceptors.test.js` => 124 pass, 0 fail; new fixtures are synthetic.

## Endpoint inventory and evidence

### Password-reset session security, 2026-11-06: open on the acceptance worktree and in 4.8.0; fixed on the redesign branch

Update (redesign branch, GA-04): `server/src/utils/auth-routes.js` and `server/src/bootstrap.js` now end every older session of the user after a successful reset and fail closed if that is not possible. Regression tests: `tests/auth-routes.test.js` ("GA-04: …" cases) and the isolated HTTP case "a successful password reset ends every older session of the user (GA-04)", passing in legacy-support and refresh on Strapi 5.61.0 dependencies. The published 4.8.0 still has the defect described below.

In an isolated real Strapi 5.58.0 / Users & Permissions 5.58.0 host using the current acceptance-worktree plugin source, a synthetic user had an existing Magic session and access token before a successful `POST /api/auth/reset-password`. In `legacy-support`, the old Magic sidecar remained active and its old bearer token still received HTTP 200 on the owner's protected `/my-sessions` endpoint after reset. In `refresh` mode the prior native session became inactive and its old bearer was denied (401/403), but the Magic sidecar still appeared active in storage. The reset response issued a new token that successfully accessed `/my-sessions` in both modes. No email was sent; the reset code and password were random synthetic values kept in the isolated process. The executable characterization runs in `tests/isolated-http-access.test.js`; its passing status describes the observed gap and is not a security pass. The complete HTTP suites passed 34 tests in legacy and 36 in refresh.

Source inspection explains the distinction for this host version: `server/src/register.js` subscribes only to explicit `blocked: true`, while `server/src/utils/auth-routes.js` classifies reset as a new session. The installed Users & Permissions controller invalidates refresh sessions during reset only in refresh mode. Other Strapi versions, the published 4.8.0 package, reset failure cases, replay, concurrent issuance and production databases remain unverified. No product behavior was changed in this check. Legacy old-token access and stale native sidecar state require a coordinated reset/revocation fix and regression tests before security acceptance; do not infer that a green characterization proves revocation.

### Isolated HTTP matrix, 2026-11-06

#### Missing license key

An authenticated super-admin POST to `/magic-sessionmanager/license/ping` on a freshly initialized isolated host without a stored license key returns the existing 400 `No license key found` response. The test asserts that the license provider verifier is not called and that the stored key remains absent. Both legacy-support and refresh HTTP suites passed with this additional case (31 and 33 tests respectively); an absolute `NODE_PATH` pointing to the workbench test-app dependencies was needed because this acceptance worktree has no local node_modules. No provider or production data was used. This closes only the missing-key case, not A2 or the other open security gates.

#### Block and revocation recovery investigation

##### Pending-marker feasibility follow-up

The proposed marker can distinguish a retry while revocation remains pending from a normal unblock of a pre-existing blocked user. It does not by itself establish crash-safe and multi-process fail-closed behavior. No marker implementation or product change was made in this follow-up.

Two additional executable characterizations run against the installed Strapi implementation:

- A successful block commits and revokes the synthetic Magic session (also the native session in refresh mode). If its response is lost, the same bodyless POST returns 200 and unblocks. With the proposed marker deleted after successful revocation, the same ambiguity remains: a later retry and a deliberate unblock have identical requests and persisted state. The test simulates response loss by ignoring the first result from the client's perspective; it does not kill a process or drop a socket.
- Two concurrent `strapi.store().set` calls are held after both `findOne` reads return empty, then released. Both writes create a record for the same key in the disposable SQLite host. The installed `@strapi/core/dist/services/core-store.js` implements set as find-then-update/create and its model declares no unique key. This controlled same-process interleaving demonstrates that an unprotected plugin-store marker is not a cross-process lock or a unique state record. It is not a PostgreSQL/MySQL or multi-process test.

Minimum design and proof obligations for a narrower failed-revocation fix:

1. Persist the pending intent and `blocked: true` together in a database transaction, with an effective per-user lock or conditional version transition. Marker-first separate commits leave a crash window in which the marker exists but the user is not blocked. A failed marker read/write must abort, not interpret the error as no marker. A transaction failing before commit leaves the previous state, so it cannot guarantee that a previously unblocked user became blocked during a database outage.
2. Only a successful, complete revocation may move that same generation to completed. Conditional clearing must not erase a newer pending operation. Concurrent requests and multiple workers must not let a request that began during pending turn into an unblock after another worker clears it. Database-backed serialization/versioning is required; an in-process mutex is insufficient. Long-lived locks across native revocation require investigation for deadlocks and transaction boundaries; an operation state with ownership/fencing and recovery is another design to verify.
3. A crash after committing pending must leave a blocked user and durable recoverable intent. A crash after partial revocation leaves pending and requires idempotent retry; already completed native/sidecar effects cannot be assumed rolled back. Failure to clear must remain pending. A crash or lost response after completed marker removal is intrinsically indistinguishable from a fresh bodyless unblock, unless callers supply a stable idempotency key or desired state, or the old contract changes.
4. Concurrent direct updates through other Strapi routes, lifecycle-triggered termination, native session issuance and a mixed-version deployment can bypass a controller-only lock or marker. Their serialization/enforcement boundaries must be designed and tested. Pre-upgrade partial failures have no historical marker and cannot be distinguished reliably from legitimate blocked accounts; migration must not silently unblock them or pretend to reconstruct intent.
5. A purpose-built uniquely constrained per-user state record, with schema migration, transaction behavior and supported database coverage, is a candidate. The installed core store alone has not supplied the needed uniqueness, compare-and-swap or fencing proof. Verify fresh install, upgrades, rollback, SQLite and supported production databases, independent processes, forced crashes at each boundary, failures before/after commit, and intentional unblock. Existing data and the Admin UI remain out of scope here.

The marker therefore remains a candidate for the narrower failed-revocation scenario, not a demonstrated safe implementation. Strict retry safety after a successful but unacknowledged operation needs an explicit request identity or desired state and a migration plan for bodyless callers. Latest isolated verification: `SESSION_HTTP_MODE=legacy-support node --test --test-reporter=dot tests/isolated-http-access.test.js` passed 30 tests; `SESSION_HTTP_MODE=refresh node --test --test-reporter=dot tests/isolated-http-access.test.js` passed 32 tests. No real provider, build or install was used.

**Historical (acceptance worktree / 4.8.0).** On the redesign branch the admin block revokes sessions once (API-12) and callers can send an explicit `{ "blocked": true | false }` that is applied idempotently; a bodyless request still toggles and is deprecated (GA-09/API-4, `tests/server-api-hardening.test.js`). A bodyless retry after a failed block is therefore still ambiguous for old callers, and the durable-intent design below is not implemented; A2 stays open. Original text: **Open security defect; no product fix applied.** The admin route accepts a bodyless toggle. The controller saves `blocked: true` before terminating sessions. The user lifecycle also tries termination on that update and catches its failure; the controller tries again and returns a sanitized 500 if that attempt fails. An injected failure at both calls leaves the user blocked and the Magic session active. The existing token is denied while the block remains. The next identical POST returns 200 and unblocks the user without revoking that session. In refresh mode the test also confirms that the synthetic native session is still active after the retry. It does not establish whether a particular token can be used after unblocking.

Failing-first evidence: temporarily asserting that the retry returns `blocked: true` failed in both isolated real Strapi HTTP modes, with actual `false`. A separate test in the same runs passed for a deliberately pre-blocked user with an active synthetic session: the same bodyless POST is the established explicit unblock and returns `blocked: false`. The normal suite retains passing characterization assertions, not a false claim of a fix. The two scenarios prove the conflict for these fixtures; the server currently records no request intent for the controller to distinguish them. The UI currently sends the same bodyless request for both actions and is outside this leaf.

Options requiring a coordinated contract decision:

1. Add an idempotent desired-state operation (`blocked: true` or `false`), migrate callers to send their intent, and retain the old toggle for compatibility. This protects migrated callers, but the old bodyless retry remains unsafe until its semantics or use changes. Define authorization, validation, concurrency and partial-revocation response semantics before implementing.
2. Record a durable pending block/revocation intent and make retries resume it, with a separately explicit unblock operation. This can preserve a fail-closed block, but changes what an old bodyless request means while pending. Define atomic persistence, recovery after crashes, competing administrators and an explicit escape for a legitimate unblock. A process-local marker or a time window cannot establish intent reliably across restarts or instances.
3. Roll back the block when revocation fails, preserving toggle retry direction. This may leave the user unblocked after the failed security action, and native revocations or earlier session writes may already have succeeded. Transaction and lifecycle behavior across supported databases would need proof; it is not equivalent to keeping access blocked.

Recommended direction for integration review is explicit desired-state requests plus durable recovery where fail-closed behavior is required, with a documented migration for bodyless clients. Neither option alone makes an unchanged bodyless retry unambiguous. Do not treat the existing 500 as proof of atomic rollback or completed revocation. Multi-process races, process termination between writes, actual database faults, and external/native provider recovery remain unverified.

Verification after restoring the characterization assertion: `SESSION_HTTP_MODE=legacy-support node --test --test-reporter=dot tests/isolated-http-access.test.js` passed 28 tests; `SESSION_HTTP_MODE=refresh node --test --test-reporter=dot tests/isolated-http-access.test.js` passed 30 tests. Both runs use temporary loopback hosts, synthetic data, isolated SQLite, fake providers and a network guard. No build, installation or live provider was used.

#### Concurrency and partial-failure results

Final evidence: normal isolated host `SESSION_HTTP_MODE=legacy-support node --test tests/isolated-http-access.test.js` 27 passed; `SESSION_HTTP_MODE=refresh ...` 29 passed. With `SESSION_HTTP_FALLBACK=1`, legacy passed 28 and refresh passed 30. Full `node --test --test-reporter=spec tests/*.test.js tests/*.test.mjs` passed 406, failed 0, skipped 0 (legacy by default). These are isolated synthetic SQLite hosts, not production verification.

- User-wide termination: deterministic real-host injection allowed one synthetic session update and rejected a second. Before the fix both JWT modes returned 200 despite the remaining active row; after the fix both return a sanitized 500. Earlier writes and native revocations may already be committed, so this is an honest partial failure, not a transaction rollback.
- Inactive cleanup: deterministic injected delete failure after another row was removed returned 200 before the fix. Both modes now return a sanitized 500; failed row remains and unrelated active row remains. The operation is not atomic, and successful removals/deny records may already persist.
- Deny-record persistence failure during admin delete: both modes return 500 and retain the session row. In native mode the native session can already have been revoked before the deny write; this test does not claim rollback of native revocation.
- Concurrent own-session termination: a barrier forces two authorized HTTP requests past the owner read before either termination executes. Both returned 200 and the target ended inactive; a different user's session remained active. This is a controlled same-process SQLite interleaving, not a multi-process, PostgreSQL or MySQL proof.
- Block partial failure: injected termination failure returns 500, but the user is already blocked and its session row remains active. Its existing token is denied while blocked. Retrying the same toggle returns 200 and unblocks the user instead of retrying revocation. This dangerous partial-state/retry behavior is **open**; changing the toggle into an idempotent desired-state operation or adding recovery crosses the agreed API contract/UI scope and needs coordinated design.
- Full-host fallback: `SESSION_HTTP_FALLBACK=1` creates a temporary Users & Permissions extension in the disposable host that removes only the built-in logout route, without modifying installed or production files. The test verifies no built-in route and exactly one actual bootstrap-registered `/api/auth/logout`. Real HTTP rejects missing, invalid and forged tokens, terminates a synthetic valid owner's session, and returns a redacted 500 when revocation is injected to fail. Both JWT modes pass. The signed-expired token case remains proven only in the separate Koa fallback harness, not in the real host; fallback-specific rate limiting remains unproven.

#### Failure coverage and input applicability, latest pass

`tests/isolated-http-access.test.js` now injects additional errors after real route authentication. Both modes exercise active/per-user admin session list failures; owner per-user list, logout, logout-all, logout-others and own-session termination failures; all license provider operations and email mismatch; GeoIP update success/failure using an injected fake updater; and user-block / timeout document-read failures. Legacy mode injects failures into the own/current-session document reads; refresh mode injects failures into their native listing service. Client responses retain the existing safe 400/500 envelopes, and the synthetic owner session remains active after rejected mutations. The injected GeoIP updater never downloads or writes a database.

Evidence: `SESSION_HTTP_MODE=legacy-support node --test tests/isolated-http-access.test.js` 22 passed; `SESSION_HTTP_MODE=refresh node --test tests/isolated-http-access.test.js` 24 passed. `node --test --test-reporter=spec tests/*.test.js tests/*.test.mjs`: 399 passed, 0 failed, 0 skipped; this full suite covers legacy, so refresh was run separately.

Input classification for each registered route is below. `none` means there is no handler-consumed client payload or path argument to invalidate, not that malformed HTTP or auth is impossible. Where a path ID exists, an unknown ID is applicable; a missing path segment normally fails routing before the handler. Provider failures are applicable only where a provider is actually called; database/service failures are applicable to persistence-backed handlers. Authentication and owner cases remain covered by the preceding HTTP matrix.

| Route | Applicable inputs / ownership | Failure evidence and remaining gap |
| --- | --- | --- |
| GET /sessions; GET /sessions/active | none; admin-wide | service exception 500; detailed DB faults open |
| GET /user/:userId/sessions | user ID; admin-wide | missing ID currently 200 empty; service exception 500; other malformed forms open |
| POST /sessions/:sessionId/terminate | session ID; admin-wide | missing 404, service exception 500; concurrency open |
| DELETE /sessions/:sessionId | session ID; admin-wide | missing 404, service exception 500; persistence/revocation ordering covered at unit level |
| POST /sessions/clean-inactive | none; admin-wide | service exception 500; partial batch failure open |
| POST /user/:userId/terminate-all | user ID; admin-wide | missing 404, DB lookup exception 500; concurrent deletion open |
| POST /user/:userId/toggle-block | user ID; admin-wide | missing 404, document lookup exception 500; lifecycle/partial mutation failure open |
| GET /users/stats | none; admin-wide | database exception 500 |
| GET /license/status | none; admin-wide | store/provider exception 500 on the redesign branch (API-7, `tests/server-api-hardening.test.js`); was 400 in 4.8.0 |
| POST /license/auto-create | admin identity; no request body; admin-wide | provider unreachable 503, other failures 500 (API-7); was 400 in 4.8.0 |
| POST /license/create | email, firstName, lastName; admin-wide | invalid input 400; provider unreachable 503, other failures 500 (API-7); was 400 in 4.8.0 |
| POST /license/ping | stored key, no request body; admin-wide | store/provider exception 500 (API-7; was 400 in 4.8.0); missing stored key 400 before any provider call (HTTP, see "Missing license key") |
| POST /license/store-key | key and optional email; admin-wide | non-string input (API-8), invalid key and email mismatch 400; provider/store exception 500 (API-7; was 400 in 4.8.0) |
| GET /geolocation/:ipAddress | IP address; admin-wide | invalid IP 400, fake provider exception 500 |
| GET /geoip/status | none; admin-wide | plugin-store exception 500 (API-7; was 400 in 4.8.0) |
| PUT /geoip/credentials | credential pair or clear; admin-wide | missing credentials 400; store exception 500 (API-7; was 400 in 4.8.0) |
| POST /geoip/update | optional force and stored credentials; admin-wide | missing credentials 400; fake updater success 200 / updater failure 502, local failure 500 (API-7; was 400 in 4.8.0); no live provider |
| GET /settings | none; admin-wide | store exception 500 (API-7; was 400 in 4.8.0) |
| PUT /settings | settings object; admin-wide | invalid body 400 with field errors (API-6); store exception 500 (API-7; was 400 in 4.8.0); partial PUT merges over stored settings (API-6); partial writes under failure open |
| POST /sessions/:sessionId/simulate-timeout | session ID; admin-wide, development only | missing 404, document exception 500; production/staging absence remains host-level gap |
| POST /logout; POST /logout-all; POST /logout-others | caller identity, bearer where applicable; caller's own sessions | service exception 500; injected failure leaves another own session active; races open |
| GET /my-sessions; GET /current-session | caller identity/bearer; caller's own sessions | document failure (legacy) / service failure (refresh) 500; 202 pending and missing current session HTTP cases open |
| GET /user/:userId/sessions (Content API) | user ID must match caller | wrong owner 403; service exception 500; other malformed IDs open |
| DELETE /my-sessions/:sessionId | non-current own session ID | missing/foreign/current and malformed native ID covered; service exception 500; race open |
| POST /api/auth/logout | bearer or built-in refresh credential; caller | native host success/denial; real-host fallback registration with `SESSION_HTTP_FALLBACK=1` (built-in route removed, exactly one bootstrap-registered route, missing/invalid/forged tokens rejected, owner terminated, injected failure redacted 500); signed-expired token only in the separate Koa harness; fallback rate limit open |

This section supersedes older open-case descriptions in historical tables below. A2 remains open for the cases explicitly named above, particularly race/partial-write behavior and fallback-route rate limiting (real-host fallback registration itself is covered by the `SESSION_HTTP_FALLBACK=1` runs, corrected 2026-11-06, GA-12); tested representative errors do not establish every possible failure. No product code or Admin UI files changed in this pass.

#### Additional HTTP edge cases, 2026-11-06

Both `SESSION_HTTP_MODE=legacy-support` and `SESSION_HTTP_MODE=refresh` runs of `node --test tests/isolated-http-access.test.js` passed 13 tests each. The actual fallback handler additionally passed `node --test tests/isolated-fallback-logout-http.test.js` (1 test). These observations supplement and, where specified, supersede the older table below.

Full suite after the additions: `node --test --test-reporter=spec tests/*.test.js tests/*.test.mjs` passed 381 tests, 0 failed, 0 skipped; this full-suite run exercises the legacy host by default and does not replace the separately executed refresh run.

| Route or component | New HTTP proof | Still open |
| --- | --- | --- |
| DELETE /sessions/:sessionId; POST /sessions/:sessionId/simulate-timeout | Missing synthetic ID returns 404; another user's synthetic session remains active. Delete service exception gives a redacted 500. | Other malformed identifiers, direct database failures. |
| POST /user/:userId/toggle-block | Missing synthetic user ID returns 404. | Database and lifecycle failure branches over HTTP. |
| GET /user/:userId/sessions (admin) | Missing synthetic user returns 200. | Whether this compatibility behavior should be changed; invalid shapes and database errors. |
| POST /sessions/:sessionId/terminate | Missing Magic and native targets return 404; injected session-service exception gives redacted 500. | Other malformed identifiers and concurrent removal. |
| POST /user/:userId/terminate-all | Missing synthetic user, numeric or document ID, returns 404 in both modes; existing active and empty users retain 200. User lookup failure gives redacted 500. | Concurrent user deletion and other persistence failures. |
| GET /api/magic-sessionmanager/user/:userId/sessions | Unknown user ID returns 403 for authenticated owner. | Other malformed forms and database failures over HTTP. |
| DELETE /api/magic-sessionmanager/my-sessions/:sessionId | Missing sidecar ID returns 404; malformed native key returns 404 in refresh mode. | Other malformed forms, concurrency and database failures. |
| GET /users/stats | Injected user database query failure returns 500 without the private error marker. | Other database failure locations. |
| GET /sessions; POST /sessions/clean-inactive | Injected session service failure returns 500 without the private error marker. | Individual storage failures and partial batch effects. |
| GET/PUT /settings; GET /geoip/status; PUT /geoip/credentials | Injected plugin-store exceptions return 400 without the private error marker. | Partial writes, specific storage failures; 400 is existing behavior. |
| GET /geolocation/:ipAddress; POST /license/create | Injected provider exception returns respectively 500 / 400 without the private marker; no external request. | Other provider endpoints and response shapes. |
| POST /api/auth/logout fallback handler | Separate private Koa HTTP harness uses the actual fallback route handler with fake Strapi dependencies: missing, malformed and wrong-signature JWTs give 401; unresolved owner gives 401; valid and signed-expired JWTs terminate the resolved synthetic owner; termination failure gives redacted 500. | Superseded for registration: the real-host `SESSION_HTTP_FALLBACK=1` runs exercise the bootstrap-registered route and auth stack. Still open: signed-expired token over the real host, fallback rate limiting. |

The fallback harness is deliberately distinct from the real Strapi host, so its HTTP proof does not establish framework middleware behavior. No UI/privacy files were edited; fake services and network restrictions prevent external effects. The previously observed missing-ID responses are corrected by the approved 404 change above.

Executable: `SESSION_HTTP_MODE=legacy-support node --test tests/isolated-http-access.test.js` and `SESSION_HTTP_MODE=refresh node --test tests/isolated-http-access.test.js`. Each starts a **fresh process**, real Strapi 5.58.0 from the workbench test-app dependencies, current plugin source, temporary SQLite database and ephemeral 127.0.0.1 port. Final rerun: 10 tests passed, 0 failed in each mode. `SESSION_HTTP_STRAPI_NODE_MODULES` overrides the default test-app dependency path; if dependencies are absent the test skips explicitly, which is not acceptance. Fake provider methods, disposable role/user/session records and generated in-memory tokens are used. Node socket connections are restricted to the exact loopback port; explicit checks show an external address and a different loopback port are rejected. CWD, GeoIP env, dotenv path and SQLite are isolated. The temporary host and database are destroyed after the run.

This HTTP evidence supersedes only the older access statements in the inventory below, not its input/provider-error gaps. In each mode every listed admin route was called anonymously, as an editor without plugin access, and as a content user: each returned 401/403. Every admin route was called as an authorized super-admin: 200, except GeoIP update deliberately returned 400 for absent credentials before any provider call. A non-super admin explicitly granted the plugin action also received 200 on GET /sessions. Every Content API route rejected anonymous, admin and an ungranted user with 401/403 and returned 200 for a synthetic authorized owner. Other-owner lookup and sidecar termination returned 403 and left the foreign session active; in refresh mode a foreign native session key returned 404 and remained active. The owner's current sidecar delete returned 400. Compatibility logout rejected missing/invalid tokens and accepted a synthetic owner, marking its sidecar inactive. No HTTP assertion establishes the fallback-only bootstrap branch when the host already has a native logout route.

Per-route HTTP evidence below: `D` = three denied principal types as described above; `S` = authorized HTTP success; `V` = an invalid-input HTTP case; `F` = HTTP fake-provider failure/redaction; `O` = HTTP other-owner denial; `C` = current-session guard. All observations apply to both tested JWT modes, except native-key denial which applies only to refresh. The legacy table that follows retains controller evidence and case-specific gaps.

| Route | HTTP evidence | Remaining cases |
| --- | --- | --- |
| GET /sessions; GET /sessions/active; GET /user/:userId/sessions | D, S | invalid identifiers and DB failure over HTTP |
| POST /sessions/:sessionId/terminate; DELETE /sessions/:sessionId; POST /sessions/clean-inactive | D, S | missing/invalid identifiers, service failure over HTTP |
| POST /user/:userId/terminate-all; POST /user/:userId/toggle-block; GET /users/stats | D, S | invalid identifiers and service failure over HTTP |
| GET /license/status; POST /license/auto-create; POST /license/ping | D, S using fakes | provider failure over HTTP |
| POST /license/create | D, S, V, F | other provider response/error variants |
| POST /license/store-key | D, S, V using fake | mismatch/provider failure over HTTP |
| GET /geolocation/:ipAddress | D, S (disabled), V | fake provider failure over HTTP |
| GET /geoip/status; PUT /geoip/credentials | D, S; credentials also V | storage failure over HTTP |
| POST /geoip/update | D, V (missing credentials) | authorized fake-updater success and provider error over HTTP; existing unit test injects a fake updater |
| GET /settings; PUT /settings | D, S; PUT also V | storage failure over HTTP |
| POST /sessions/:sessionId/simulate-timeout | D, S in test environment | production/staging absence over HTTP |
| POST /logout; POST /logout-all; POST /logout-others | D, S | race/error behavior over HTTP; compatibility fallback details |
| GET /my-sessions; GET /current-session | D, S; list excludes foreign sidecar | HTTP pending/missing/error branches |
| GET /user/:userId/sessions | D, S, O | invalid ID and service failure over HTTP |
| DELETE /my-sessions/:sessionId | D, S, O, C; foreign native key in refresh | concurrent deletion and service failure over HTTP |
| POST /api/auth/logout | invalid/missing token denied; S and sidecar inactive | expired token, fallback-only registration branch, provider/DB failure over HTTP |

All paths below are router-relative except the compatibility path. A = admin authenticated plus `plugin::magic-sessionmanager.access`; U = Users & Permissions strategy and read/write rate-limit middleware. Admin ownership is intentionally unrestricted after A; U is limited to the authenticated user's resources. Route configuration is tested, not equivalent to HTTP authorization proof. Standard helper errors use the Strapi error envelope; the compatibility route writes its own `{error:{status,name,message}}`. `endpoint-error-contracts.test.js` additionally injects dependency failures into 15 session handlers, both settings, all five license and all three GeoIP handlers and checks safe error bodies; it also checks malformed IP rejection. This does not exercise every downstream provider-specific failure. A 'gap' is not a pass.

| Method and path | Handler | Input; success contract | Evidence and outstanding cases |
| --- | --- | --- | --- |
| A GET /sessions | session.getAllSessionsAdmin | none; `data`, count/active/inactive meta | `native-session-routes`: list/meta; HTTP access and service errors open |
| A GET /sessions/active | session.getActiveSessions | none; `data`, count meta | `native-session-routes`: list/meta; HTTP access and errors open |
| A GET /user/:userId/sessions | session.getUserSessions | user ID; `data`, count meta | `native-session-routes`: list/meta; admin HTTP access and errors open |
| A POST /sessions/:sessionId/terminate | session.terminateSingleSession | session ID; message/success | route config only; success, invalid ID, not found and errors need endpoint proof |
| A DELETE /sessions/:sessionId | session.deleteSession | session ID; message/success; 404 missing | `session-controller-delete`: success/404; HTTP access and errors open |
| A POST /sessions/clean-inactive | session.cleanInactiveSessions | none; message/success/deletedCount | service revocation tests; controller/HTTP success and errors open |
| A POST /user/:userId/terminate-all | session.terminateAllUserSessions | user ID; message/success | route config only; success, invalid ID, not found and errors need proof |
| A POST /user/:userId/toggle-block | session.toggleUserBlock | user ID; message/blocked/success; 404 missing | route config only; success, not found and errors need endpoint proof |
| A GET /users/stats | session.getUserStatsAdmin | none; success/data counts | `admin-user-statistics.test.js` controller coverage; HTTP access open |
| A GET /license/status | license.getStatus | none; success/valid/demo/hasKey/data | `license-controller`: absent/present key; failure and HTTP access open |
| A POST /license/auto-create | license.autoCreate | authenticated admin; success/message/data; 401 no admin | `license-controller`: denied and fake-provider success; provider failure and HTTP access open |
| A POST /license/create | license.createAndActivate | email, firstName, lastName; success/message/data; 400 invalid | `license-controller`: valid and invalid identity; provider failure and HTTP access open |
| A POST /license/ping | license.ping | stored key; success/message/data; 400 absent | `license-controller`: fake-provider success; missing key/failure/HTTP access open |
| A POST /license/store-key | license.storeKey | licenseKey, optional email; success/message/data; 400 invalid/mismatch | `license-controller`: success, invalid and mismatch; HTTP access and thrown-provider error open |
| A GET /geolocation/:ipAddress | session.getIpGeolocation | IPv4/IPv6; success/data; 400 invalid | `geolocation-disabled.test.js`: disabled behavior; HTTP access, invalid input and provider errors require endpoint proof |
| A GET /geoip/status | geoip.getStatus | none; success/status; no key | `geoip-controller`: key redaction; HTTP access and errors open |
| A PUT /geoip/credentials | geoip.storeCredentials | accountId/licenseKey or clear; success/hasCredentials; 400 invalid | `geoip-controller`: fake storage; invalid/error/HTTP access open |
| A POST /geoip/update | geoip.updateDatabase | optional force; success/result; 400 missing credentials | `geoip-controller`: fake updater and missing credentials; thrown provider error/HTTP access open |
| A GET /settings | settings.getSettings | none; success/settings | `settings.test.js`: defaults; HTTP access and errors open |
| A PUT /settings | settings.updateSettings | settings object; success/settings/message; 400 invalid | `settings.test.js`: fake storage, invalid body/path; HTTP access and store errors open |
| A POST /sessions/:sessionId/simulate-timeout | session.simulateTimeout | session ID; message/success; 404 missing; 403 staging/production | dev-only route omitted for production/staging; HTTP and controller case coverage open |
| U POST /logout | session.logout | bearer; message/terminated; 401 missing | `native-session-routes`: native/legacy and missing user; HTTP authorization and provider errors open |
| U POST /logout-all | session.logoutAll | authenticated user; message/terminatedCount; 401 missing | `native-session-routes`: owner and missing user; HTTP authorization and errors open |
| U POST /logout-others | session.logoutOthers | bearer; message/count and preserved/fallback flags; 401 missing | `native-session-routes`: native preservation/fallback and missing user; legacy path, HTTP authorization and errors open |
| U GET /my-sessions | session.getOwnSessions | authenticated user; data/meta; 401 missing | `native-session-routes`: native list, current and truncation; HTTP authorization, legacy and errors open |
| U GET /current-session | session.getCurrentSession | bearer; data, or 202 pending, 404 missing, 401 missing | `native-session-routes`: native result; HTTP authorization, legacy, pending and errors need endpoint proof |
| U GET /user/:userId/sessions | session.getUserSessions | owner ID; data/count; 403 other/unresolved | `ownership-permissions`: owner/other/unresolved; HTTP authorization and provider errors open |
| U DELETE /my-sessions/:sessionId | session.terminateOwnSession | own non-current session ID; message/success/alreadyTerminated; 400 current, 403 foreign sidecar, 404 absent/native foreign | `native-session-routes`: native owner/foreign/current/idempotence and legacy idempotence; linked current regression; HTTP authorization and provider errors open |
| POST /api/auth/logout | bootstrap compatibility handler, only if no existing route | verified bearer or cryptographically verified just-expired bearer; 200 ok/message, 401 invalid/unresolved, 500 failure | `auth-interceptors`: registration, owner delegation, unresolved owner; native built-in logout intercepted separately; real HTTP, expiry/signature and error paths open. Handler declares `auth:false` but verifies token itself. |

Native refresh-mode and legacy-mode selection occurs inside session handlers; bootstrap also intercepts built-in login, refresh, password-change and logout flows rather than registering them as plugin routes. Tests for these interceptors are fakes and do not prove real host behavior. `session-required` is a separately exported opt-in policy, not declared on the above routes. It now fails closed on unresolved identity or lookup failure in strict mode, while relaxed mode retains fail-open behavior. Its interaction with host route configuration still needs integration proof; the bootstrap JWT wrapper has separate fail-closed tests.

## Verification limitations

A2 remains open: real isolated-host authentication, authorization and applicable ownership cases now have HTTP evidence in both modes, but the matrix still lists input, provider failure and special-branch gaps. Ownership is not applicable to admin-wide resources. No production or external service was contacted. Build, installed-types, UI and broader integration checks belong to the integration owner. An initial `npm test -- --test-reporter=dot` returned 342/343 with its failure details lost to output truncation while other leaves were editing; subsequent direct full `node --test --test-reporter=spec tests/*.test.js tests/*.test.mjs` runs returned 343/343 and later 352/352 before subsequent tests were added. The initial failure is unidentified, not asserted to be harmless.

Latest full Node suite after HTTP tests: `node --test --test-reporter=spec tests/*.test.js tests/*.test.mjs` returned 374 passed, 0 failed, 0 skipped. It covers the default legacy HTTP mode; the separate refresh command above is required for the other mode.
