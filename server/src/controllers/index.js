'use strict';

const session = require('./session');
const license = require('./license');
const settings = require('./settings');
const geoip = require('./geoip');

module.exports = {
  session,
  license,
  settings,
  geoip,
};
