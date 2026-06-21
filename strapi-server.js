'use strict';

const server = require('./dist/server/index.js');

module.exports = server.default || server;
