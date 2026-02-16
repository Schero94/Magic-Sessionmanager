'use strict';

/**
 * Default service for magic-sessionmanager plugin
 */
module.exports = ({ strapi }) => ({
  /** Returns a welcome message for the plugin */
  getWelcomeMessage() {
    return 'Welcome to Strapi [START]';
  },
});
