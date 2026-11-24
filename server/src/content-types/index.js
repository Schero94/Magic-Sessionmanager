'use strict';

const session = require('./session/schema.json');
const revokedToken = require('./revoked-token/schema.json');
const securityEvent = require('./security-event/schema.json');

module.exports = {
  session: {
    schema: session,
  },
  'revoked-token': {
    schema: revokedToken,
  },
  // One security event log (4.15): admin sign-ins and sign-outs, failed
  // attempts, lockouts, who signed out whom, Content Manager activity, and
  // later app-user security events. Hidden from the Content Manager and the
  // Content-Type Builder.
  'security-event': {
    schema: securityEvent,
  },
};
