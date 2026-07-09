const assert = require('node:assert/strict');
const test = require('node:test');

const getClientIp = require('../server/src/utils/getClientIp');

function createCtx({ headers = {}, requestIp = '10.0.0.10', trustedProxies } = {}) {
  return {
    request: {
      headers,
      ip: requestIp,
    },
    state: trustedProxies === undefined
      ? {}
      : { __magicSessionSettings: { trustedProxies } },
    app: {
      proxy: false,
      context: {
        strapi: {
          config: {
            get: () => ({}),
          },
          log: {
            debug: () => {},
          },
        },
      },
    },
  };
}

test('getClientIp ignores spoofable proxy headers unless proxies are trusted', () => {
  const ctx = createCtx({
    headers: { 'x-forwarded-for': '203.0.113.99, 10.0.0.1' },
    requestIp: '10.0.0.10',
    trustedProxies: false,
  });

  assert.equal(getClientIp(ctx), '10.0.0.10');
});

test('getClientIp honors stored trustedProxies setting from request state', () => {
  const ctx = createCtx({
    headers: { 'x-forwarded-for': '203.0.113.99, 10.0.0.1' },
    requestIp: '10.0.0.10',
    trustedProxies: true,
  });

  assert.equal(getClientIp(ctx), '203.0.113.99');
});

test('getClientIp prefers Cloudflare header when proxy trust is enabled', () => {
  const ctx = createCtx({
    headers: {
      'cf-connecting-ip': '198.51.100.7',
      'x-forwarded-for': '203.0.113.99, 10.0.0.1',
    },
    requestIp: '10.0.0.10',
    trustedProxies: true,
  });

  assert.equal(getClientIp(ctx), '198.51.100.7');
});
