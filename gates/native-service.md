# Gates: Native session service and sidecar

Scope: Native sessions and Magic metadata/history merge through the existing session service.

- [x] S1: Optional native session ID is additive; existing Magic IDs and legacy rows remain compatible.
  CHECK: node --test tests/session-service.test.js tests/native-session-service.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 140.409083

- [x] S2: Native refresh updates the sidecar link atomically with conditional token-hash updates.
  CHECK: node --test tests/session-service.test.js tests/native-session-service.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 133.630167

- [x] S3: Per-user and admin views include active native sessions, preserve Magic history, and reconcile external native revokes.
  CHECK: node --test tests/native-session-service.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 136.251708

- [x] S4: Cross-user listing uses paged users and bounded native-manager concurrency; failures cannot masquerade as complete results.
  CHECK: node --test tests/native-session-service.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 137.941709

- [x] S5: Native-only view IDs and optional user-agent/IP fields remain safe for existing consumers.
  CHECK: node --test tests/native-session-service.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 155.952209

- [x] S6: Native revocation completes before sidecar termination or deletion; native failure leaves Magic data unchanged.
  CHECK: node --test tests/native-session-service.test.js tests/session-revocation.test.js
  EXPECT: # fail 0
  EVIDENCE: # todo 0 | # duration_ms 157.768292

- [x] S7: Service changes have accurate JSDoc and pass back-end type/runtime verification.
  CHECK: npm run test:ts:back && npm run build && npm run verify:runtime
  EXPECT: Server bundle runtime check passed
  EVIDENCE: dist/server/index.mjs  448.4kb | ⚡ Done in 30ms
