'use strict';

const session = require('./session/schema.json');
const revokedToken = require('./revoked-token/schema.json');
const securityEvent = require('./security-event/schema.json');
const impersonation = require('./impersonation/schema.json');

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
  // Time-limited impersonations (4.20): who opened which account, why and
  // until when. Ended rows are deleted after 7 days; the security log keeps
  // the record. Hidden from the Content Manager and the Content-Type Builder.
  impersonation: {
    schema: impersonation,
  },
};
