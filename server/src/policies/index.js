'use strict';

/**
 * Plugin policies index
 */

const sessionRequired = require('./session-required');

module.exports = {
  'session-required': sessionRequired,
};
