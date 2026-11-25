'use strict';

const { createLogger } = require('./utils/logger');
const { createContentApiPermissionsLifecycle } = require('./utils/content-api-permissions');
const { isCallerRevocationScope } = require('./utils/block-revocation-scope');
const { checkStrapiVersion } = require('./utils/strapi-version');
const { disableGraphqlShadowCrud } = require('./utils/security-log-hardening');

const USER_UID = 'plugin::users-permissions.user';

/**
 * Plugin register hook.
 *
 * - Logs one error when the running Strapi is older than the supported floor
 *   (`MIN_STRAPI_VERSION`, 5.50.0).
 * - Registers the `access` RBAC action for admin access control, the
 *   `admin-sessions.read` / `admin-sessions.revoke` actions for the Strapi
 *   admin panel sessions view, `admin-activity.read` for the admin
 *   sign-in history and Content Manager activity, and `settings.update`
 *   (4.17) for the protected settings (location lookup, webhooks, security
 *   log).
 * - Registers `impersonate.users` (4.20) for starting, listing and ending
 *   impersonations of app users, and `impersonate.admins` for the read-only
 *   permission preview of another admin.
 * - Disables GraphQL Shadow CRUD for the plugin's internal content types
 *   when the GraphQL plugin is installed (4.17).
 * - Removes the `sessions` relation field from the User content type so it
 *   doesn't clutter the default edit view (sessions are displayed via the
 *   SessionInfoPanel side panel).
 * - Subscribes to User lifecycle events so `user.blocked = true` automatically
 *   terminates all of that user's active sessions.
 *
 * @param {{strapi: object}} deps
 */
module.exports = async ({ strapi }) => {
  const log = createLogger(strapi);

  log.info('[START] Plugin registration starting...');
  checkStrapiVersion(strapi, log);

  strapi.admin.services.permission.actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Access the Session Manager plugin',
      uid: 'access',
      // Strapi 5's role editor only renders checkboxes for actions that
      // belong to a subCategory. Without this field the permission
      // exists but is invisible in Settings → Roles → Plugins → Session
      // Manager, so admins cannot grant or revoke it.
      subCategory: 'General',
      pluginName: 'magic-sessionmanager',
    },
    // Strapi admin panel sessions (4.14). Strapi grants every registered
    // action to the Super Admin role at boot; other roles get nothing until
    // a Super Admin grants it in Settings > Roles.
    {
      section: 'plugins',
      displayName: 'Read admin panel sessions',
      uid: 'admin-sessions.read',
      subCategory: 'Admin panel',
      pluginName: 'magic-sessionmanager',
    },
    {
      section: 'plugins',
      displayName: 'Sign out admins',
      uid: 'admin-sessions.revoke',
      subCategory: 'Admin panel',
      pluginName: 'magic-sessionmanager',
    },
    // Admin sign-in history and Content Manager activity (4.15): who signed
    // in from where and what each admin did. Separate from reading the
    // sessions, because it shows IP addresses and work activity.
    {
      section: 'plugins',
      displayName: 'View admin activity',
      uid: 'admin-activity.read',
      subCategory: 'Admin panel',
      pluginName: 'magic-sessionmanager',
    },
    // Protected settings (4.17): IP location lookup (whether and where IP
    // addresses are sent), team notification webhooks (the URLs are
    // secrets) and the security log. The other settings stay on `access`.
    {
      section: 'plugins',
      displayName:
        'Change protected settings (location lookup, webhooks, security log, sign-in policies)',
      uid: 'settings.update',
      subCategory: 'Settings',
      pluginName: 'magic-sessionmanager',
    },
    // Lifting a sign-in lock of an app user or IP address (4.17). Seeing the
    // locks only needs plugin access.
    {
      section: 'plugins',
      displayName: 'Unlock locked sign-ins',
      uid: 'lockouts.unlock',
      subCategory: 'General',
      pluginName: 'magic-sessionmanager',
    },
    // Impersonation of app users (4.20): a short-lived credential for one
    // Users & Permissions user, with a reason, logged. Super Admin holds it
    // automatically; other roles only when granted. Works only while the
    // Impersonation switch in the settings is on.
    {
      section: 'plugins',
      displayName: 'Impersonate app users',
      uid: 'impersonate.users',
      subCategory: 'Impersonation',
      pluginName: 'magic-sessionmanager',
    },
    // "View as admin" (4.20): a read-only preview of which content types and
    // actions another admin can use. Never a Super Admin, never oneself, and
    // for non-Super-Admins only admins whose permissions are a subset of
    // their own.
    {
      section: 'plugins',
      displayName: 'View as admin (read-only permission preview)',
      uid: 'impersonate.admins',
      subCategory: 'Impersonation',
      pluginName: 'magic-sessionmanager',
    },
  ]);

  disableGraphqlShadowCrud(strapi, log);

  try {
    strapi.db.lifecycles.subscribe(createContentApiPermissionsLifecycle(strapi));
  } catch (err) {
    log.warn('Could not monitor Authenticated role permission changes:', err?.name || 'Error');
  }

  try {
    const userCT = strapi.contentType(USER_UID);

    if (!userCT) {
      log.error('User content type not found');
      return;
    }

    if (userCT.attributes && userCT.attributes.sessions) {
      delete userCT.attributes.sessions;
      log.info('[SUCCESS] Removed sessions field from User content type');
    }

    strapi.db.lifecycles.subscribe({
      models: [USER_UID],

      /**
       * Terminates the user's active sessions the MOMENT they are blocked.
       *
       * We only fire on the transition to `blocked: true` — i.e. when the
       * update's params.data actually flips the field. This avoids running
       * a session-scan query on every unrelated user update (email change,
       * profile picture, …) which at scale would be a real load problem.
       *
       * @param {object} event
       */
      async afterUpdate(event) {
        try {
          const { result, params } = event;
          if (!result || result.blocked !== true) return;

          // Only act when THIS update actually set blocked=true. Without
          // this check, every update of an already-blocked user would
          // re-run the session scan for no gain.
          const data = params && params.data ? params.data : null;
          if (!data || data.blocked !== true) return;

          const userDocId = result.documentId;
          if (!userDocId) return;

          // The admin block endpoint revokes the sessions itself and reports
          // failures; revoking here as well would run every revocation twice.
          if (isCallerRevocationScope(userDocId)) return;

          const sessionService = strapi.plugin('magic-sessionmanager').service('session');
          const { terminatedCount: terminated } = await sessionService.terminateSession({
            userId: userDocId,
            reason: 'blocked',
          });

          if (terminated > 0) {
            log.info(`[lifecycle] Terminated ${terminated} session(s) for blocked end user`);
          }
        } catch (err) {
          log.warn('[lifecycle] afterUpdate hook failed:', err?.name || 'Error');
        }
      },

      /**
       * Deleting an app user deletes what the security log holds about them.
       *
       * @param {object} event
       */
      async afterDelete(event) {
        try {
          const documentId = event?.result?.documentId;
          if (!documentId) return;
          await strapi
            .plugin('magic-sessionmanager')
            .service('security-log')
            .deleteUserData(documentId);
        } catch (err) {
          log.warn('[lifecycle] Security events of a deleted user stay:', err?.name || 'Error');
        }
      },
    });

    log.info('[SUCCESS] Plugin registered successfully');
  } catch (err) {
    log.error('[ERROR] Registration error:', err?.name || 'Error');
  }
};
