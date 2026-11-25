const assert = require('node:assert/strict');
const test = require('node:test');

const getClientIp = require('../server/src/utils/getClientIp');
const {
  normalizeTrustedProxies,
  validateTrustedProxies,
} = require('../server/src/utils/trusted-proxies');

/**
 * Koa-like context. `requestIp` is what Koa resolved (`ctx.request.ip`),
 * `socket` the TCP peer.
 */
function createCtx({
  headers = {},
  requestIp = '10.0.0.10',
  socket = '10.0.0.10',
  trustedProxies,
  configTrustedProxies,
} = {}) {
  return {
    request: { headers, ip: requestIp },
    req: { socket: { remoteAddress: socket } },
    state: trustedProxies === undefined ? {} : { __magicSessionSettings: { trustedProxies } },
    app: {
      proxy: true,
      context: {
        strapi: {
          config: { get: () => ({ trustedProxies: configTrustedProxies }) },
          log: { debug: () => {} },
        },
      },
    },
  };
}

const SPOOF_HEADERS = {
  'cf-connecting-ip': '198.51.100.7',
  'true-client-ip': '198.51.100.8',
  'x-real-ip': '198.51.100.9',
  'x-client-ip': '198.51.100.10',
  'x-cluster-client-ip': '198.51.100.11',
  forwarded: 'for=198.51.100.12',
  'x-forwarded-for': '198.51.100.13, 203.0.113.50',
};

test('H2: client-set proxy headers never choose the address (no trusted proxy list)', () => {
  // Koa resolved 203.0.113.50 (proxy.koa + maxIpsCount 1: the right-most hop).
  for (const trustedProxies of [undefined, false, true, null, []]) {
    const ctx = createCtx({ headers: SPOOF_HEADERS, requestIp: '203.0.113.50', trustedProxies });
    assert.equal(getClientIp(ctx), '203.0.113.50', `trustedProxies=${trustedProxies}`);
  }
});

test('H2: legacy trustedProxies true no longer reads True-Client-IP or X-Real-IP', () => {
  const ctx = createCtx({
    headers: { 'true-client-ip': '198.51.100.1', 'x-real-ip': '198.51.100.2' },
    requestIp: '10.0.0.10',
    trustedProxies: true,
  });
  assert.equal(getClientIp(ctx), '10.0.0.10');
});

test('trusted proxy list: a listed peer gives the right-most untrusted X-Forwarded-For hop', () => {
  const ctx = createCtx({
    headers: { 'x-forwarded-for': '198.51.100.13, 203.0.113.50, 10.0.0.2' },
    requestIp: '198.51.100.13',
    socket: '::ffff:10.0.0.1',
    trustedProxies: ['10.0.0.0/8'],
  });
  assert.equal(getClientIp(ctx), '203.0.113.50');
});

test('trusted proxy list: a peer that is not listed is used as is, headers ignored', () => {
  const ctx = createCtx({
    headers: { 'x-forwarded-for': '198.51.100.13', 'true-client-ip': '198.51.100.8' },
    requestIp: '198.51.100.13',
    socket: '192.0.2.44',
    trustedProxies: ['10.0.0.0/8'],
  });
  assert.equal(getClientIp(ctx), '192.0.2.44');
});

test('trusted proxy list: a malformed hop ends the chain; all-trusted falls back', () => {
  const malformed = createCtx({
    headers: { 'x-forwarded-for': '198.51.100.13, not-an-ip, 10.0.0.3' },
    socket: '10.0.0.1',
    trustedProxies: ['10.0.0.0/8'],
  });
  assert.equal(getClientIp(malformed), '10.0.0.3');
  const allTrusted = createCtx({
    headers: { 'x-forwarded-for': '10.0.0.4, 10.0.0.3' },
    socket: '10.0.0.1',
    trustedProxies: ['10.0.0.0/8'],
  });
  assert.equal(getClientIp(allTrusted), '10.0.0.4');
  const noHeader = createCtx({ socket: '10.0.0.1', trustedProxies: ['10.0.0.0/8'] });
  assert.equal(getClientIp(noHeader), '10.0.0.1');
});

test('trusted proxy list from the plugin config when no request settings are loaded', () => {
  const ctx = createCtx({
    headers: { 'x-forwarded-for': '203.0.113.60' },
    socket: '127.0.0.1',
    configTrustedProxies: ['127.0.0.1/32'],
  });
  assert.equal(getClientIp(ctx), '203.0.113.60');
});

test('trustedProxies validation: legacy booleans become an empty list, CIDRs are checked', () => {
  assert.deepEqual(validateTrustedProxies(true), { value: [], error: null, legacyTrue: true });
  assert.deepEqual(validateTrustedProxies(false), { value: [], error: null, legacyTrue: false });
  assert.deepEqual(validateTrustedProxies(['10.0.0.0/8', '10.0.0.0/8', '::1']).value, [
    '10.0.0.0/8',
    '::1',
  ]);
  assert.deepEqual(validateTrustedProxies(['10.0.0.0/8', 'nope']).error.path, [
    'trustedProxies',
    1,
  ]);
  assert.ok(validateTrustedProxies('10.0.0.0/8').error);
  assert.deepEqual(normalizeTrustedProxies(true), []);
  assert.deepEqual(normalizeTrustedProxies(['bad', '192.0.2.0/24']), ['192.0.2.0/24']);
});
