'use strict';

module.exports = async ({ strapi }) => {
  // Stop license pinging
  if (strapi.licenseGuard && strapi.licenseGuard.pingInterval) {
    clearInterval(strapi.licenseGuard.pingInterval);
    strapi.log.info('[magic-sessionmanager] 🛑 License pinging stopped');
  }

  // Stop cleanup interval
  if (strapi.sessionManagerIntervals && strapi.sessionManagerIntervals.cleanup) {
    clearInterval(strapi.sessionManagerIntervals.cleanup);
    strapi.log.info('[magic-sessionmanager] 🛑 Session cleanup interval stopped');
  }

  strapi.log.info('[magic-sessionmanager] ✅ Plugin cleanup completed');
};

