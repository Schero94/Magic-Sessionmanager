'use strict';

const session = require('./session/schema.json');

module.exports = {
  'plugin::magic-sessionmanager.session': {
    schema: session,
  },
};
