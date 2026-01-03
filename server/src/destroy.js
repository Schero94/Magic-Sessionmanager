'use strict';

const { createLogger } = require('./utils/logger');

module.exports = async ({ strapi }) => {
  const log = createLogger(strapi);
  
  // Stop license pinging
  if (strapi.licenseGuard && strapi.licenseGuard.pingInterval) {
    clearInterval(strapi.licenseGuard.pingInterval);
    log.info('[STOP] License pinging stopped');
  }

  // Stop cleanup interval
  if (strapi.sessionManagerIntervals && strapi.sessionManagerIntervals.cleanup) {
    clearInterval(strapi.sessionManagerIntervals.cleanup);
    log.info('[STOP] Session cleanup interval stopped');
  }

  log.info('[SUCCESS] Plugin cleanup completed');
};

