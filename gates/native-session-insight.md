# Untracked Strapi sessions: capture gaps, summary and clean-up

Branch `feat/native-session-insight`, 2026-11-12. Synthetic data only; no production database was read.

## Capture paths (refresh mode)

Integration suite `tests/isolated-native-capture-http.test.js`, Strapi 5.61.0 (`@strapi/strapi`, `@strapi/plugin-users-permissions`, `@strapi/plugin-graphql`), outbound network blocked.

| Path                                                      | origin/main (4.12.0)       | This branch                                               |
| --------------------------------------------------------- | -------------------------- | --------------------------------------------------------- |
| `POST /api/auth/local`                                    | linked                     | linked                                                    |
| `POST /api/auth/local/register`                           | linked                     | linked                                                    |
| `POST /api/auth/refresh` (rotated child)                  | linked                     | linked                                                    |
| `POST /api/auth/change-password`                          | linked                     | linked                                                    |
| `POST /api/auth/reset-password`                           | linked                     | linked                                                    |
| `GET /api/auth/:provider/callback` (synthetic provider)   | linked                     | linked                                                    |
| `GET /api/auth/email-confirmation`                        | no session (302)           | no session                                                |
| Any of the above with `api.rest.prefix: '/v1'`            | **not linked**             | linked                                                    |
| GraphQL `login` mutation                                  | **not linked**             | linked                                                    |
| GraphQL `emailConfirmation` mutation                      | **not linked**             | linked                                                    |
| Custom route returning `{ jwt, refreshToken }`            | **not linked**             | linked                                                    |
| Custom route returning `jwt.issue()` (access token only)  | **not linked**             | linked                                                    |
| Intercepted route with an unawaited `jwt.issue()` Promise | **503, session left open** | 200, real token, linked                                   |
| Token delivered out of band (not in the response)         | not linked                 | not linked (cannot be captured; counted "after tracking") |

Baseline column: the same suite against `git archive origin/main` server source on the same host.

## Evidence

- [x] Unit: `npm test` 755 pass, 0 fail (host-dependent suites skipped without a host). `npm run lint`, `npm run format:check`, `test:ts:front`, `test:ts:back`, `build`, `verify`, `verify:runtime` clean.
- [x] Packed tarball (`npm pack`, 49 files) loaded through `SESSION_HTTP_PLUGIN_DIR`: SQLite `/api` 18/18, PostgreSQL 16 `/api` 18/18, SQLite `/v1` 18/18, PostgreSQL `/v1` 18/18.
- [x] Workbench test-app host (Strapi 5.58.0): `isolated-http-access` legacy 37/37, refresh 39/39; capture suite 16/16 (no GraphQL plugin there).
- [ ] Known, pre-existing: on the 5.61.0 host, `isolated-http-access` fails 3 subtests (anonymous `POST /api/logout` 500, GA-04 old token 500, block-failure 500) identically on origin/main; not caused by this branch.
- [x] RBAC: summary and end routes deny anonymous, editor and content-user tokens (401/403); query parameters → 400; non-empty end body → 400; admin-origin session and linked sessions untouched; sessions younger than two minutes kept.
- [x] `npm audit --omit=dev`: 0 vulnerabilities. `npm ci --dry-run` with npm 10.9.8 and 11.21.2: exit 0. No dependency changes.
- [ ] MySQL: not run (no local server). SQL limited to `COUNT`, `SUM(CASE ...)`, `IS NULL`, bound dates and `NOT EXISTS`.

## Browser acceptance

Host 127.0.0.1:1356, packed tarball, SQLite, refresh mode, egress blocked (expected blocked: `api.github.com` releases). Playwright 1.65 (Chromium 158), `measure.js` from the workbench skill.

- [x] Widths 1440, 1280, 1080, 1079, 1024, 768, 767, 520, 519, 390, 320 in light and dark for: neutral notice, neutral disclosure, warning notice, warning disclosure; confirm dialog at 1440, 1024, 768, 390, 320; locales en/de/fr/es/pt at 1440 and 320. 108 measurements: `documentOverflow` 0, `rowHeightMismatch`, `offScaleGaps`, `clippedText`, `smallTargets`, `lowContrast`, `elementsOutsideViewport` all empty.
- [x] Keyboard: Tab reaches "Why?", Enter opens it (`aria-expanded=true`, focus stays); Escape closes the confirm dialog and focus returns to "End these sessions"; Cancel sends no request; confirm sends exactly one `POST /native-only/end` and shows "37 untracked sessions ended. 6 are left; …".
- [x] Locale leak check: no ICU placeholders or raw ids in any locale.
- [x] Console: 0 plugin messages; core/host only (`useRBAC` object warning, `adminApi` reducer warning, React Router future flag, blocked GitHub release check).
- [x] Screenshots `pics/untracked-*.webp` and `docs/site/img/untracked-*.webp` opened and checked: `*.example.test` users, loopback IPs, no tokens.
