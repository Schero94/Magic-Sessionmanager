'use strict';

/**
 * Default controller for magic-sessionmanager plugin
 */
module.exports = ({ strapi }) => ({
  /** Returns a welcome message for the plugin */
  index(ctx) {
    ctx.body = strapi
      .plugin('magic-sessionmanager')
      .service('service')
      .getWelcomeMessage();
  },
});
