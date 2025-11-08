'use strict';

const session = require('./session');
const licenseGuard = require('./license-guard');
const geolocation = require('./geolocation');
const notifications = require('./notifications');

module.exports = {
  session,
  'license-guard': licenseGuard,
  geolocation,
  notifications,
};
