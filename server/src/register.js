'use strict';

/**
 * Register hook
 * Sessions relation is hidden from UI to keep User interface clean
 * Sessions are accessed via the Session Manager plugin UI components
 */
module.exports = async ({ strapi }) => {
  strapi.log.info('[magic-sessionmanager] [START] Plugin registration starting...');

  try {
    // Get the user content type
    const userCT = strapi.contentType('plugin::users-permissions.user');

    if (!userCT) {
      strapi.log.error('[magic-sessionmanager] User content type not found');
      return;
    }

    // REMOVE sessions relation from User content type to keep UI clean
    // Sessions are managed through SessionInfoPanel sidebar instead
    if (userCT.attributes && userCT.attributes.sessions) {
      delete userCT.attributes.sessions;
      strapi.log.info('[magic-sessionmanager] [SUCCESS] Removed sessions field from User content type');
    }

    strapi.log.info('[magic-sessionmanager] [SUCCESS] Plugin registered successfully');
    
  } catch (err) {
    strapi.log.error('[magic-sessionmanager] [ERROR] Registration error:', err);
  }
};
