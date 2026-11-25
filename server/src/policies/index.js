'use strict';

/**
 * Plugin policies index
 */

const sessionRequired = require('./session-required');
const canImpersonate = require('./can-impersonate');

module.exports = {
  'session-required': sessionRequired,
  'can-impersonate': canImpersonate,
};
