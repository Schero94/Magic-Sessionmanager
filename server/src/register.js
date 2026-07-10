'use strict';

const { createLogger } = require('./utils/logger');

const USER_UID = 'plugin::users-permissions.user';

/**
 * Plugin register hook.
 *
 * - Registers the `access` RBAC action for admin access control.
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
  ]);

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

          const sessionService = strapi.plugin('magic-sessionmanager').service('session');
          const { terminatedCount: terminated } = await sessionService.terminateSession({
            userId: userDocId,
            reason: 'blocked',
          });

          if (terminated > 0) {
            log.info(`[lifecycle] Terminated ${terminated} session(s) for blocked user ${userDocId.substring(0, 8)}...`);
          }
        } catch (err) {
          log.warn('[lifecycle] afterUpdate hook failed:', err.message);
        }
      },
    });

    log.info('[SUCCESS] Plugin registered successfully');

  } catch (err) {
    log.error('[ERROR] Registration error:', err);
  }
};
