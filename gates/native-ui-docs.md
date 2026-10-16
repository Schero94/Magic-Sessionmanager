# Gates: Admin display and documentation

Scope: Magic admin screens render native-only session rows safely and plugin documentation explains both session modes.

- [x] U1: Existing admin view model can open, export and terminate native-only rows without requiring a Magic token or `documentId` from storage.
  CHECK: node --test tests/admin-accessibility.test.mjs tests/native-session-service.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 191.767

- [x] U2: Missing IP, device, and GeoIP values are rendered as unavailable without fabricated details.
  CHECK: node --test tests/admin-accessibility.test.mjs tests/native-session-service.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 218.0295

- [x] U3: README documents native refresh mode, unchanged legacy mode, preserved routes, and the no-auto-config behavior.
  EVIDENCE: README.md sections "Session management modes" and "Native Users & Permissions sessions" document Strapi-owned refresh/revocation, the unchanged `legacy-support` mode, preserved Magic endpoint contracts, no host-auth auto-switch or record migration, Authenticated-only permission setup, and preservation of saved role choices.

- [x] U4: Changelog records the backward-compatible native session support.
  EVIDENCE: CHANGELOG.md `Unreleased` entry records native Users & Permissions end-user session support, legacy compatibility, preserved endpoints and the admin-session exclusion.

- [x] U5: New or materially changed non-trivial server functions have accurate JSDoc.
  EVIDENCE: Parent-reviewed JSDoc is present on the native adapter/service/view helpers, deferred Content API permission retry and administrator-choice lifecycle, native auth resolution/compensation, and `getCurrentNativeSessionId` in server/src.
