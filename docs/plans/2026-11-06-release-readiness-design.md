# Magic Session Manager release readiness

Approved direction: complete the Strapi 5 release preparation, keeping the existing native Strapi admin experience and public contracts. Work in this isolated plugin worktree. Do not push or publish.

## Current state

The 4.7.2 plugin has Dashboard, Settings, Analytics, Activation, session details, an Online Users widget, and a Users & Permissions user panel. The existing functional acceptance plan inventories 20 admin and seven content API routes, access rules, native and legacy behavior, and the UI action matrix. The baseline suite passed 336 tests. The shared host is pinned to Strapi 5.58.0; npm lists 5.61.0 as latest stable on 2026-11-06. The plugin production dependency audit reports two high findings through Strapi utils and zod; assess again after a compatible update.

## Target and boundaries

- Verify the newest compatible Strapi 5 release and the dependency graph; retain Strapi's supported React and router peer versions. Do not force an incompatible major upgrade or claim unsupported peers work.
- Preserve paths, methods, response envelopes, native and legacy modes, session ownership and server-side RBAC. Tests cover authorized, anonymous, wrong-role, wrong-owner, malformed-input and provider failure cases. Any behavior fix starts with a failing regression test and an explicit API contract.
- Review each reachable screen, action, loading, empty, error and confirmation state against the current Strapi Design System, keyboard use and accessible names. Use Playwright CLI at 320, 390, 519, 520, 767, 768, 1024, 1079, 1080 and 1440 pixels. Measure overflow and exercise mobile drawer controls.
- Use an isolated local host, synthetic users and provider fakes. Never affect existing sessions or expose credentials, tokens, identifiers or personal data in browser evidence. Do not contact real providers.
- Verify plugin tests, both type checks, build, SDK and runtime verification, package contents, host build and startup, and browser/API acceptance separately. Record residual advisories and unresolved gates without describing them as passed.
- Preserve other plugin checkouts and pre-existing workspace changes. Publishing, pushing, real services and Strapi administrator session management are out of scope.

The existing `2026-10-16-sessionmanager-functional-acceptance.md` contains detailed route and action contracts. Changes to those contracts require an explicit new design rather than a silent compatibility break.
