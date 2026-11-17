'use strict';

const session = require('./session');
const settings = require('./settings');
const geoip = require('./geoip');
const adminSessions = require('./admin-sessions');

module.exports = {
  session,
  settings,
  geoip,
  'admin-sessions': adminSessions,
};
