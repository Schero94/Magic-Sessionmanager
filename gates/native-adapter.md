# Gates: Native session adapter

Scope: A tested, fail-closed facade over Strapi's native Users & Permissions session manager.

- [x] A1: Legacy mode selects the existing plugin flow and never invokes native methods.
  CHECK: node --test tests/native-session-manager.test.js
  EXPECT: # fail 0
  EVIDENCE: Parent reran `node --test tests/native-session-manager.test.js`: 8 tests passed, 0 failed.

- [x] A2: Refresh mode exposes checked token validation, active-session check, listing and revocation methods.
  CHECK: node --test tests/native-session-manager.test.js
  EXPECT: # fail 0
  EVIDENCE: Parent reran `node --test tests/native-session-manager.test.js`: 8 tests passed, 0 failed.

- [x] A3: Missing origin or required native methods fail closed with an actionable error.
  CHECK: node --test tests/native-session-manager.test.js
  EXPECT: # fail 0
  EVIDENCE: Parent reran `node --test tests/native-session-manager.test.js`: 8 tests passed, 0 failed, including missing-origin/method cases.

- [x] A4: Adapter has JSDoc and does not log or retain access/refresh tokens.
  EVIDENCE: `server/src/utils/native-session-manager.js:16-24,64-74,77-96,109-112` documents the lazy resolver, forwarding, facade and token handling. The module has no logging or token storage.

- [x] A5: Back-end type check and runtime bundle include the adapter.
  CHECK: npm run test:ts:back && npm run build && npm run verify:runtime
  EXPECT: Server bundle runtime check passed
  EVIDENCE: dist/server/index.mjs  448.4kb | ⚡ Done in 33ms
