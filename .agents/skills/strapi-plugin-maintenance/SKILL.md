---
name: strapi-plugin-maintenance
description: Maintain Magic-Sessionmanager as a standalone Strapi 5 plugin, including session ownership, conditional access, admin UI and API permissions.
---

# Magic-Sessionmanager maintenance

Use Node 22. Check local rules, current Strapi 5 docs through Context7 and latest compatible 5.x against the pinned workbench before changing auth/session hooks. Do not embed credentials, encryption keys or browser auth state in skills, source or Git; do not push without an explicit request.

Trace `server/src/routes/admin.js`, `content-api.js`, bootstrap JWT wrapper, session services and `admin/src/permissions.js`. Make a route matrix for anonymous, unauthorised admin, allowed admin, own session and other user's session. Check revocation, session listing, settings and analytics on the server; hiding a menu is not access control. Public hooks or compatibility routes require a documented signature/token and rate limit. Verify encryption key fallback is development-only, no token/PII logging, retention and GeoIP consent/availability; do not call external GeoIP services in a smoke test.

For the admin UI, use Strapi 5 Design System components, permission-backed navigation, accessible table actions, focus and responsive settings forms. Run `npm test`, `npm run build`, `npm run verify:runtime`; then shared app build, boot and Playwright CLI checks. Report independent unit, integration and negative-permission evidence separately.
