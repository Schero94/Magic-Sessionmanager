'use strict';

const register = require('./register');
const bootstrap = require('./bootstrap');
const destroy = require('./destroy');
const config = require('./config');
const contentTypes = require('./content-types');
const routes = require('./routes');
const controllers = require('./controllers');
const services = require('./services');
const middlewares = require('./middlewares');

module.exports = {
  register,
  bootstrap,
  destroy,
  config,
  contentTypes,
  routes,
  controllers,
  services,
  middlewares,
};
