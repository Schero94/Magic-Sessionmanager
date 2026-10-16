# Session Manager warning and details modal design

Status: approved for implementation under the user's prior approval to choose the best plugin design.

## Current state

The General Settings page renders the relaxed-session warning through Strapi Design System 2.2.4 `Alert`. Its internal content container is a wrapping flex row. The title and body remain siblings in that row, so long copy starts to the right of the title instead of below it. The supplied screenshot shows this on desktop. A Playwright DOM measurement confirmed the title at x=541 and the body at x=715, a 174 px offset. The visible close icon also had no `onClose` callback, so it could not dismiss the warning.

The `SessionDetailModal` displays status, user, device, timeline, location/security, and optional technical details. It uses a 900 px maximum width, two columns above 768 px, repeated icons, 11 px field labels, and values without a guaranteed long-word wrap. Date formatting is fixed to `de-DE`. Browser versions are always empty even when a user agent contains one. The active-session action calls the existing admin terminate route after a native confirmation. Inactive sessions cannot be terminated from the modal.

The existing function matrix and test suite cover the route inventory, authentication, plugin permissions, ownership, native and legacy session lifecycle, token revocation, and destructive-action guards. The most recent recorded plugin quality run passed 324 tests. Prior Playwright evidence opened and closed the details modal and exercised its technical-details toggle. It did not confirm a logout from a populated modal. The current screenshot also proves the alert's visual layout was not caught by the source and responsive checks.

## User roles and scope

- Administrators with `plugin::magic-sessionmanager.access` can inspect Users & Permissions end-user sessions and end an active end-user session.
- The plugin remains scoped to Users & Permissions end users. Strapi Admin accounts and their sessions are excluded.
- Browser acceptance uses only synthetic session rows and requests intercepted in the isolated local preview. No real account is logged out.

## Design options

For the warning, the choices are to keep the Design System `Alert` and force each text paragraph onto its own full-width flex row, replace the component with a custom warning panel, or shorten the message to one sentence. Keep the Strapi `Alert` and correct its content layout. This preserves its warning semantics, icon, border, and dismiss control without dropping the security explanation.

For the detail view, the choices are to keep the current repeated icon rows, replace the details with a dense table, or use aligned semantic label/value pairs grouped by section. Use the grouped label/value layout. It keeps each value attached to its label, supports long translated values, and stacks cleanly on small screens.

## Target state

- The warning title begins at the same x coordinate as its body. The body takes the available width below the title at every supported viewport and keeps its paragraph separation.
- The warning's close button dismisses it for the current view. Changing the strict-enforcement draft restores the warning when the policy is relaxed again.
- The modal keeps a clear status and user identity, groups user, device, timeline, location/security, and technical details under semantic headings, and pairs every label with its value using definition-list semantics.
- Detail labels are comfortably readable, values can wrap without widening the modal, and each field remains understandable at 320 CSS px.
- Dates use the active Strapi locale and show an unavailable fallback for invalid or missing timestamps. Browser versions are shown when present in parsed user-agent or native metadata. Missing idle time remains an explicit unavailable value.
- The modal keeps its existing close behavior and existing termination confirmation. The terminate action is available only for an active Users & Permissions session, shows pending state, posts to the existing endpoint, refreshes the dashboard, and closes on success. Failure leaves the modal open and reports an error.
- No server route, permission, request body, response envelope, legacy endpoint, or session ownership rule changes.

## API and security contract

The modal uses `POST /magic-sessionmanager/sessions/:sessionId/terminate` with the selected session ID in the path and no request body. It remains behind Strapi admin authentication and `plugin::magic-sessionmanager.access`. Success retains the controller response `{ message: string, success: true }`. The handler continues to return a safe 500 response when the termination service fails. Do not weaken the route policy or add a Content API token path to the admin modal.

End-user self-service routes remain unchanged: `POST /logout`, `POST /logout-all`, `POST /logout-others`, `GET /my-sessions`, `GET /current-session`, `GET /user/:userId/sessions`, and `DELETE /my-sessions/:sessionId`. They remain Users & Permissions JWT authenticated, rate limited, and owner scoped. Strapi Admin sessions are not queried or mutated.

## Acceptance criteria

1. Regression tests fail before the warning layout and close behavior are changed, then pass after. Browser measurements show title and body aligned within 1 CSS px at 320, 390, 519, 520, 767, 768, 1024, 1079, 1080, and 1440 px. Closing the alert does not save settings, and changing enforcement resets its dismissal.
2. Modal labels and values remain paired, long IDs and user-agent strings wrap, missing values never render as `Invalid Date` or `undefined`, and browser version appears when a synthetic user agent contains one.
3. At the same viewport matrix the modal has no page-level horizontal overflow. The modal body scrolls when needed, close and details controls work by keyboard, and focus remains usable.
4. A synthetic active end-user session can be opened, the confirmation can be dismissed without a POST, and a confirmed logout sends exactly one POST to the unchanged admin route. A successful fake response refreshes the list and closes the modal. An inactive synthetic row cannot be terminated.
5. Existing route, permission, native-session, legacy-session, owner-boundary, and token-revocation tests continue to pass. No real provider or real user session is touched.

## Documentation references

- Strapi 5 Design System migration notes: https://docs.strapi.io/cms/migration/v4-to-v5/breaking-changes/design-system
- Installed `@strapi/design-system` 2.2.4 Alert and Modal type declarations and runtime implementation under `test-app/node_modules/@strapi/design-system/dist/`.
- Context7 was queried on 2026-10-16 but its monthly quota was exhausted. The official Strapi migration page, installed component types, and installed runtime were checked instead.
