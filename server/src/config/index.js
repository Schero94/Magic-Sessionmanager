'use strict';

module.exports = {
  default: {
    // Rate limit for lastSeen updates (in milliseconds)
    lastSeenRateLimit: 30000, // 30 seconds

    // Session inactivity timeout (in milliseconds)
    // After this time without activity, a session is considered inactive
    inactivityTimeout: 15 * 60 * 1000, // 15 minutes
  },
  validator: (config) => {
    if (config.lastSeenRateLimit && typeof config.lastSeenRateLimit !== 'number') {
      throw new Error('lastSeenRateLimit must be a number (milliseconds)');
    }
    if (config.inactivityTimeout && typeof config.inactivityTimeout !== 'number') {
      throw new Error('inactivityTimeout must be a number (milliseconds)');
    }
  },
};
