'use strict';

const { createLogger } = require('./utils/logger');

const USER_UID = 'plugin::users-permissions.user';
const SESSION_UID = 'plugin::magic-sessionmanager.session';

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

          const activeSessions = await strapi.documents(SESSION_UID).findMany({
            filters: { user: { documentId: userDocId }, isActive: true },
            fields: ['documentId'],
            limit: 1000,
          });

          if (!activeSessions || activeSessions.length === 0) return;

          const now = new Date();
          let terminated = 0;
          for (const session of activeSessions) {
            try {
              await strapi.documents(SESSION_UID).update({
                documentId: session.documentId,
                data: { isActive: false, terminatedManually: true, logoutTime: now },
              });
              terminated++;
            } catch (updateErr) {
              log.warn(`[lifecycle] failed to terminate session ${session.documentId}:`, updateErr.message);
            }
          }

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
