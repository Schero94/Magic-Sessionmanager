'use strict';

const { createLogger } = require('./utils/logger');

/**
 * Plugin destroy hook. Clears all known intervals and timers created during
 * bootstrap so Strapi can shut down cleanly (important for tests and for
 * zero-downtime restarts).
 */
module.exports = async ({ strapi }) => {
  const log = createLogger(strapi);

  if (strapi.sessionManagerIntervals) {
    // Both setInterval and setTimeout handles are tracked on the same
    // object. clearInterval / clearTimeout accept the other form on all
    // supported Node versions, but we call both to be explicit and to
    // avoid future warnings if the engines diverge.
    for (const [name, handle] of Object.entries(strapi.sessionManagerIntervals)) {
      if (!handle) continue;
      try {
        clearInterval(handle);
        clearTimeout(handle);
        log.info(`[STOP] ${name} timer stopped`);
      } catch (err) {
        log.warn(`Failed to stop ${name} timer:`, err?.name || 'Error');
      }
    }
    strapi.sessionManagerIntervals = {};
  }

  if (Array.isArray(strapi.sessionManagerUnsubscribers)) {
    for (const unsubscribe of strapi.sessionManagerUnsubscribers) {
      try {
        if (typeof unsubscribe === 'function') unsubscribe();
      } catch (err) {
        log.warn('Failed to remove a database subscriber:', err?.name || 'Error');
      }
    }
    strapi.sessionManagerUnsubscribers = [];
  }

  log.info('[SUCCESS] Plugin cleanup completed');
};
