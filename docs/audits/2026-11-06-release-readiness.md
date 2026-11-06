# Release readiness: 2026-11-06

Status: incomplete. Do not publish this branch as a release yet.

## Completed checks

- The plugin checkout was clean before this work. Work is isolated on `codex/sessionmanager-release-2026-11-06`; the original plugin checkout and the shared workbench's existing changes were not modified.
- Node 22.23.1, Strapi 5.61.0 and Strapi utils 5.61.0 were used in the isolated plugin checkout. `@strapi/strapi` is pinned to 5.61.0 in its dev dependencies. The supported Strapi peer remains 5.x and React 18 is retained because Strapi 5.61.0 declares React 18 and router 6 peers.
- `npm test` passed 336 tests. Both frontend and backend TypeScript checks, `npm run build`, `npm run verify`, and `npm run verify:runtime` passed. `npm pack --dry-run` reported 46 files, without publishing.
- A separate minimal test host on Strapi 5.61.0 built and booted against this worktree with an isolated SQLite database and a synthetic administrator. It is not the shared eight-plugin host.
- Playwright CLI loaded Dashboard, General Settings, Analytics and Activation. At each of 320, 390, 519, 520, 767, 768, 1024, 1079, 1080 and 1440 CSS pixels, all 40 checks reported zero document-level horizontal overflow. This does not prove component-level overflow, complete accessibility, or all action flows. Desktop and 390px mobile General Settings screenshots were visually inspected; the mobile Security Settings accordion opened and exposed named switches.

## Open gates and findings

- `npm audit --omit=dev` reports two high findings in the plugin dependency graph through `@strapi/utils` and `zod`, including [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Strapi utils 5.61.0 declares zod 4.4.3. npm suggests an incompatible Strapi 4 downgrade; it was not applied. Applicability and safe upstream remediation remain to be evaluated.
- The existing shared host's audit reports 3 critical, 27 high, 14 moderate and 2 low findings. This is the existing Strapi 5.58.0 graph, not a measurement of an upgraded shared host.
- The isolated host reported favicon HTTP 500 because this minimal test host has no `favicon.png`; this is a host fixture issue, not a diagnosed plugin failure. React Router and `useRBAC` warnings remain to be attributed. The fresh bootstrap initially logged that the authenticated role was unavailable; the role existed after boot and the code contains deferred permission setup, but a fresh-install end-user journey still needs verification.
- Privacy finding requiring product review: defaults enable geolocation and set `geoIpProvider` to `auto`. In `server/src/services/geolocation.js`, a public IP can be sent to ipapi.co when no usable local MMDB exists, or when a local lookup fails under the applicable failure mode. This was established by source inspection, not by making a provider request. Evaluate disclosure, consent and safe defaults without silently breaking existing deployments.
- Full UI/UX review, action and populated-state coverage, accessibility and keyboard checks, browser-level negative access checks, shared eight-plugin host build/boot, and integration checks remain open. The minimal host does not establish compatibility with the user's full host. No claims about professionalization or release acceptance follow from the partial width checks.
- The two named workspace skills `strapi-ui-design` and `joulee-strapi-admin-ux` were not found in the available skill paths; no admin UI source files were changed.

During these checks, no npm publish, Git push, live session mutation, or deliberate external provider operation was performed.
