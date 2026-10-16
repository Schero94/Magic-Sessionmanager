'use strict';

const session = require('./session/schema.json');
const revokedToken = require('./revoked-token/schema.json');

module.exports = {
  session: {
    schema: session,
  },
  'revoked-token': {
    schema: revokedToken,
  },
};
