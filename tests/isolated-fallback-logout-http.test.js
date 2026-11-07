'use strict';

// Exercise the actual fallback handler over a private HTTP socket. This is a
// Koa harness with fake Strapi dependencies, not full Strapi route integration.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');

const { resolveHostDependencies, assertHostAvailable } = require('./helpers/host-dependencies');
const { mountLogoutRoute } = require('../server/src/bootstrap').__private;

// koa and jsonwebtoken come from a Strapi host install; without one this
// suite skips (or fails when SESSION_HTTP_REQUIRED=1) instead of crashing.
const host = resolveHostDependencies(['koa', 'jsonwebtoken']);

test(
  'fallback logout handler verifies signed tokens and ownership over isolated HTTP',
  { skip: host.skip },
  async (t) => {
    assertHostAvailable(host);
    const Koa = require(path.join(host.modules, 'koa'));
    const jwt = require(path.join(host.modules, 'jsonwebtoken'));
    const secret = crypto.randomBytes(32).toString('hex');
    const userId = 987654321;
    let userExists = true;
    let serviceFails = false;
    const calls = [];
    let registered;
    const strapi = {
      config: {
        get: (key, fallback) => (key === 'plugin::users-permissions.jwtSecret' ? secret : fallback),
      },
      server: {
        listRoutes: () => [],
        routes: (routes) => {
          [registered] = routes;
        },
      },
      plugin: () => ({ service: () => ({ verify: async (token) => jwt.verify(token, secret) }) }),
      entityService: {
        findOne: async () => (userExists ? { documentId: 'synthetic-fallback-owner' } : null),
      },
    };
    const sessionService = {
      terminateAuthenticatedSession: async (input) => {
        if (serviceFails) throw new Error('synthetic-private-service-error');
        calls.push(input);
      },
    };
    const log = { debug() {}, info() {}, error() {}, warn() {} };
    mountLogoutRoute({ strapi, log, sessionService });
    assert.equal(registered.path, '/api/auth/logout');
    assert.equal(registered.config.auth, false);
    const app = new Koa();
    app.use(async (ctx) => {
      if (ctx.path === registered.path && ctx.method === registered.method)
        return registered.handler(ctx);
      ctx.status = 404;
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    const originalConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args) {
      const options = Array.isArray(args[0])
        ? args[0][0]
        : typeof args[0] === 'object'
          ? args[0]
          : { port: args[0], host: args[1] };
      if (
        Number(options.port) !== port ||
        !['127.0.0.1', '::1'].includes(options.host || options.hostname)
      )
        throw new Error('Outbound network disabled in isolated test');
      return originalConnect.apply(this, args);
    };
    t.after(async () => {
      try {
        await new Promise((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve()))
        );
      } finally {
        net.Socket.prototype.connect = originalConnect;
      }
    });
    const request = async (token) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: await response.json() };
    };
    const valid = jwt.sign({ id: userId }, secret, { expiresIn: '1h' });
    const expired = jwt.sign({ id: userId }, secret, { expiresIn: -1 });
    const forged = jwt.sign({ id: userId }, crypto.randomBytes(32).toString('hex'));
    for (const token of [undefined, 'not-a-token', forged]) {
      assert.equal((await request(token)).status, 401);
      assert.equal(calls.length, 0);
    }
    userExists = false;
    assert.equal((await request(valid)).status, 401);
    assert.equal(calls.length, 0);
    userExists = true;
    for (const token of [valid, expired]) {
      const result = await request(token);
      assert.equal(result.status, 200);
      assert.equal(result.body.ok, true);
      const call = calls.at(-1);
      assert.equal(call.userDocumentId, 'synthetic-fallback-owner');
      assert.equal(call.accessToken, token);
      assert.equal(call.refreshToken, null);
    }
    assert.equal(calls.length, 2);
    serviceFails = true;
    const failed = await request(valid);
    assert.equal(failed.status, 500);
    assert.equal(JSON.stringify(failed.body).includes('synthetic-private-service-error'), false);
    assert.equal(calls.length, 2);
  }
);
