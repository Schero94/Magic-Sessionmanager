'use strict';

const session = require('./session');
const settings = require('./settings');
const geoip = require('./geoip');
const adminSessions = require('./admin-sessions');
const adminActivity = require('./admin-activity');
const lockouts = require('./lockouts');

module.exports = {
  session,
  settings,
  geoip,
  'admin-sessions': adminSessions,
  'admin-activity': adminActivity,
  lockouts,
};
