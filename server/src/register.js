'use strict';

const { createLogger } = require('./utils/logger');

/**
 * Register hook
 * Sessions relation is hidden from UI to keep User interface clean
 * Sessions are accessed via the Session Manager plugin UI components
 */
module.exports = async ({ strapi }) => {
  const log = createLogger(strapi);
  
  log.info('[START] Plugin registration starting...');

  try {
    // Get the user content type
    const userCT = strapi.contentType('plugin::users-permissions.user');

    if (!userCT) {
      log.error('User content type not found');
      return;
    }

    // REMOVE sessions relation from User content type to keep UI clean
    // Sessions are managed through SessionInfoPanel sidebar instead
    if (userCT.attributes && userCT.attributes.sessions) {
      delete userCT.attributes.sessions;
      log.info('[SUCCESS] Removed sessions field from User content type');
    }

    log.info('[SUCCESS] Plugin registered successfully');
    
  } catch (err) {
    log.error('[ERROR] Registration error:', err);
  }
};
