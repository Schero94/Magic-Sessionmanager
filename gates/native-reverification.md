# Gates: Native session integration re-verification

Scope: Re-verify the completed Strapi-native Users & Permissions integration against current source, tests and a fresh isolated local Strapi runtime without touching the existing local database or administrator sessions.

- [x] NVR1: Current plugin unit, type, build, SDK and runtime-bundle checks pass.
  CHECK: node scripts/plugins.mjs Magic-Sessionmanager quality
  EXPECT: ALL PLUGIN QUALITY GATES PASSED
  EVIDENCE: 2026-10-15 current run passed 273/273 tests, frontend/backend TypeScript, package verification, server runtime-bundle verification and plugin build. The command ended with `ALL PLUGIN QUALITY GATES PASSED`.

- [x] NVR2: The shared Strapi 5 admin app builds from the current plugin checkout.
  CHECK: npm run app:build
  EXPECT: ✔ Building admin panel (
  EVIDENCE: `npm run app:build` exited 0 and ended with `✔ Building admin panel (16135ms)`.

- [x] NVR3: The fresh runtime host registers all eight configured plugins on a new database and verified loopback port.
  EVIDENCE: Strapi 5.58.0 / Node 22.23.1 booted at 127.0.0.1:1338 with `DATABASE_FILENAME=.tmp/native-session-reverify.GAFfbvyZ/data.db`. The startup log listed all eight plugin keys. Before test registration the new database had 0 U&P users, 0 admin users, 0 Magic sessions and 0 Strapi sessions. Test-only GeoIP settings were disabled before requests.

- [x] NVR4: Native login, list, refresh rotation, ownership denial, Magic logout-others/all and native logout agree on the new end-user session state.
  EVIDENCE: On the isolated host, two generated `example.invalid` U&P users registered successfully. Native and Magic session listings correlated the same session ID; refresh rotated the HttpOnly cookie and linked the Magic sidecar to Strapi's child session. Cross-user listing returned 403. Magic single-session deletion revoked the native session and its access token; logout-others retained the caller; logout-all revoked the caller. Users & Permissions logout and the existing Magic logout both revoked their native sessions. Protected list requests with each revoked token were denied.

- [x] NVR5: Existing Magic route paths, methods, permissions, response contracts and legacy-support behavior remain covered by current regression tests.
  CHECK: node --test plugins/Magic-Sessionmanager/tests/route-contracts.test.js plugins/Magic-Sessionmanager/tests/native-session-routes.test.js plugins/Magic-Sessionmanager/tests/auth-interceptors.test.js plugins/Magic-Sessionmanager/tests/refresh-token.test.js
  EXPECT: # fail 0
  EVIDENCE: 60/60 targeted route, native/legacy auth-interceptor and refresh-token tests passed. They assert existing route method/path/auth/permission contracts, legacy-support token behavior, native ownership boundaries, HttpOnly refresh handling and logout response envelopes.

- [x] NVR6: Runtime and browser verification remain limited to synthetic Users & Permissions end users; Strapi Admin sessions and external providers are not touched.
  EVIDENCE: The test DB ended with 2 synthetic U&P users, 0 admin users, 5 inactive Magic sidecars, 0 raw access/refresh tokens, 0 active Strapi sessions and 0 non-Users-&-Permissions native sessions. Email confirmation was disabled by the fresh default settings and GeoIP was explicitly disabled. No provider was contacted; the 1338 process was stopped after verification. The pre-existing 1337 process/database was not mutated.
