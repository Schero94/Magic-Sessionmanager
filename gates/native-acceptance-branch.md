# Gates: Product acceptance branch integration

Scope: Admin UI model, docs, package checks, shared Strapi host and browser acceptance agree.

- [x] P1: UI/docs and runtime acceptance leaves pass their gates with parent-rerun evidence.
  CHECK: node /Users/schero/.agents/skills/unlazy/scripts/gate-check.mjs --status gates/native-ui-docs.md && node /Users/schero/.agents/skills/unlazy/scripts/gate-check.mjs --status gates/native-acceptance.md
  EXPECT: UNMET: 0
  EVIDENCE: Parent reran both status checks on 2026-10-15. `native-ui-docs.md`: ALL MET (5). `native-acceptance.md`: ALL MET (7).

- [x] P2: Native plugin changes pass complete package tests, TS checks, verify and clean build.
  CHECK: npm test && npm run test:ts:back && npm run test:ts:front && npm run verify && npm run verify:runtime && npm run build
  EXPECT: # fail 0
  EVIDENCE: dist/server/index.mjs  448.4kb | ⚡ Done in 28ms

- [x] P3: Current browser evidence covers authenticated Magic UI at desktop/mobile and negative access.
  EVIDENCE: E5 records the authenticated UI checks at 390x844 and 1440x1000. E6 records anonymous, wrong-owner and unauthenticated-admin denial responses. Plugin pages had no console errors; the two host warnings and unrelated U&P editor 404s are identified in E5.
