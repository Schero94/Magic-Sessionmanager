'use strict';

const session = require('./session');
const settings = require('./settings');
const geoip = require('./geoip');
const adminSessions = require('./admin-sessions');
const adminActivity = require('./admin-activity');
const lockouts = require('./lockouts');
const selfService = require('./self-service');
const webhooks = require('./webhooks');
const impersonation = require('./impersonation');
const userActivity = require('./user-activity');

module.exports = {
  session,
  settings,
  geoip,
  'admin-sessions': adminSessions,
  'admin-activity': adminActivity,
  lockouts,
  'self-service': selfService,
  webhooks,
  impersonation,
  'user-activity': userActivity,
};
