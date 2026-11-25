'use strict';

// Sign in as this admin (4.23): the pure rules (tested Strapi range,
// durations, start body, which admin API requests an impersonation session
// may make) and the request guard with a fake service.

const test = require('node:test');
const assert = require('node:assert/strict');

const rules = require('../server/src/utils/admin-sign-in-rules');
const createGuard = require('../server/src/middlewares/admin-impersonation-guard');

test('only tested Strapi releases enable the feature', () => {
  assert.deepEqual(rules.adminSignInSupport('5.64.0'), {
    supported: true,
    version: '5.64.0',
    reason: null,
  });
  assert.equal(rules.adminSignInSupport('5.50.0').supported, true);
  assert.equal(rules.adminSignInSupport('5.64.3').supported, true);
  assert.equal(rules.adminSignInSupport('5.64.0-beta.1').supported, true);
  for (const version of ['5.49.9', '5.65.0', '6.0.0', '4.25.0']) {
    assert.deepEqual(rules.adminSignInSupport(version), {
      supported: false,
      version,
      reason: 'untested-version',
    });
  }
  for (const version of [undefined, null, '', 'latest', 5]) {
    assert.equal(rules.adminSignInSupport(version).reason, 'unknown-version');
  }
});

test('durations fit into one admin access token', () => {
  assert.deepEqual(rules.allowedSignInDurations(undefined), [15, 30]);
  assert.deepEqual(rules.allowedSignInDurations(1800), [15, 30]);
  assert.deepEqual(rules.allowedSignInDurations(1200), [15]);
  assert.deepEqual(rules.allowedSignInDurations(600), []);
  assert.deepEqual(rules.allowedSignInDurations('abc'), [15, 30]);
});

test('the start body needs a reason and a duration; changes are off by default', () => {
  const ok = rules.validateSignInBody({ reason: ' Ticket 4711 ', durationMinutes: 15 }, [15, 30]);
  assert.deepEqual(ok.value, { reason: 'Ticket 4711', durationMinutes: 15, allowChanges: false });
  const changes = rules.validateSignInBody(
    { reason: 'Ticket 4711', durationMinutes: 30, allowChanges: true },
    [15, 30]
  );
  assert.equal(changes.value.allowChanges, true);
  for (const body of [
    null,
    [],
    'x',
    { reason: 'ab', durationMinutes: 15 },
    { reason: 'Ticket', durationMinutes: 60 },
    { reason: 'Ticket', durationMinutes: '15' },
    { reason: 'Ticket', durationMinutes: 15, allowChanges: 'yes' },
    { reason: 'Ticket', durationMinutes: 15, admin: 1 },
    { reason: 'Ticket', durationMinutes: 30 },
  ]) {
    assert.equal(rules.validateSignInBody(body, [15]).value, null, JSON.stringify(body));
  }
});

test('read-only by default, identity and plugin changes never, logout ends only', () => {
  const kind = rules.classifyAdminImpersonationRequest;
  assert.equal(kind('GET', '/content-manager/collection-types/api::a.a'), 'read');
  assert.equal(kind('HEAD', '/admin/users/me'), 'read');
  assert.equal(kind('POST', '/admin/permissions/check'), 'read');
  assert.equal(kind('POST', '/Admin//Permissions/Check/'), 'read');
  assert.equal(kind('POST', '/admin/logout'), 'logout');
  assert.equal(kind('GET', '/magic-sessionmanager/admin-impersonation/self'), 'self');
  assert.equal(kind('POST', '/magic-sessionmanager/admin-impersonation/self/end'), 'self');
  assert.equal(kind('POST', '/content-manager/collection-types/api::a.a'), 'write');
  assert.equal(kind('PUT', '/content-manager/collection-types/api::a.a/x'), 'write');
  assert.equal(kind('DELETE', '/upload/files/1'), 'write');
  for (const [method, path] of [
    ['PUT', '/admin/users/me'],
    ['POST', '/admin/users'],
    ['PUT', '/admin/users/2'],
    ['DELETE', '/admin/users/me/sessions/abc'],
    ['PUT', '/admin/roles/3'],
    ['POST', '/admin/api-tokens'],
    ['POST', '/admin/api-tokens/1/regenerate'],
    ['POST', '/admin/transfer/tokens'],
    ['PUT', '/admin/providers/options'],
    ['POST', '/admin/renew-token'],
    ['POST', '/admin/login'],
    ['POST', '/admin/register-admin'],
    ['POST', '/admin/reset-password'],
    ['POST', '/magic-sessionmanager/impersonation/admins/2/sign-in'],
    ['POST', '/magic-sessionmanager/admin-sessions/admins/2/sign-out-everywhere'],
    ['PUT', '/magic-sessionmanager/settings'],
  ]) {
    assert.equal(kind(method, path), 'identity', `${method} ${path}`);
  }
  assert.equal(rules.recordedPath('/content-manager/x?secret=1'), '/content-manager/x');
  assert.equal(rules.recordedPath('/x'.repeat(200)).length, 200);
});

/**
 * Builds the guard with a fake service and runs one request.
 *
 * @param {object} options Request and impersonation.
 * @returns {Promise<{ctx: any, calls: any, nextCalled: boolean}>}
 */
async function run({
  method = 'GET',
  path = '/content-manager/x',
  token = 'Bearer '.concat('t'.repeat(60)),
  impersonationId = 'imp1',
  impersonation = {
    id: 'imp1',
    actorId: '1',
    targetId: '3',
    state: 'active',
    expiresAt: Date.now() + 60000,
    allowChanges: false,
  },
  status = 200,
  lookupThrows = false,
} = {}) {
  const calls = { ended: [], writes: [], refused: [] };
  const service = {
    adminImpersonationOfToken: async () => {
      if (lookupThrows) throw new Error('db');
      return impersonationId;
    },
    loadAdminForGuard: async () => impersonation,
    end: async (id, options) => {
      calls.ended.push([id, options]);
      return true;
    },
    recordAdminWrite: (imp, request) => calls.writes.push(request),
    recordRefusedAdminCall: (imp, reason, request) => calls.refused.push([reason, request]),
  };
  const strapi = {
    config: { get: () => '/api' },
    plugin: () => ({ service: () => service }),
  };
  const guard = createGuard({}, { strapi });
  const headers = {};
  const ctx = {
    method,
    path,
    request: { headers: token ? { authorization: token } : {} },
    state: {},
    status: 404,
    body: undefined,
    set: (key, value) => {
      headers[key] = value;
    },
    headers,
  };
  let nextCalled = false;
  await guard(ctx, async () => {
    nextCalled = true;
    ctx.status = status;
  });
  return { ctx, calls, nextCalled };
}

test('guard: other requests pass untouched', async () => {
  const content = await run({ path: '/api/articles', method: 'POST' });
  assert.equal(content.nextCalled, true);
  assert.equal(content.ctx.headers['X-Magic-Impersonation'], undefined);
  const anonymous = await run({ token: null, method: 'POST' });
  assert.equal(anonymous.nextCalled, true);
  const normal = await run({ impersonationId: null, method: 'POST' });
  assert.equal(normal.nextCalled, true);
  assert.equal(normal.ctx.state.magicAdminImpersonation, undefined);
});

test('guard: reads pass and are marked; read-only writes are refused and recorded', async () => {
  const read = await run();
  assert.equal(read.nextCalled, true);
  assert.equal(read.ctx.headers['X-Magic-Impersonation'], 'true');
  assert.equal(read.ctx.state.magicAdminImpersonation.actorId, '1');
  assert.equal(read.calls.writes.length, 0);

  const write = await run({ method: 'POST' });
  assert.equal(write.nextCalled, false);
  assert.equal(write.ctx.status, 403);
  assert.equal(write.ctx.body.error.details.reason, 'impersonation-read-only');
  assert.deepEqual(write.calls.refused[0][0], 'read-only');
});

test('guard: with "Allow changes" writes pass and are attributed; identity never', async () => {
  const impersonation = {
    id: 'imp1',
    actorId: '1',
    targetId: '3',
    state: 'active',
    expiresAt: Date.now() + 60000,
    allowChanges: true,
  };
  const write = await run({ method: 'PUT', path: '/content-manager/x/1?q=1', impersonation });
  assert.equal(write.nextCalled, true);
  assert.deepEqual(write.calls.writes, [
    { method: 'PUT', path: '/content-manager/x/1', status: 200 },
  ]);
  const identity = await run({ method: 'PUT', path: '/admin/users/me', impersonation });
  assert.equal(identity.nextCalled, false);
  assert.equal(identity.ctx.body.error.details.reason, 'impersonation-identity');
  const token = await run({ method: 'POST', path: '/admin/api-tokens', impersonation });
  assert.equal(token.ctx.status, 403);
});

test('guard: logout ends the impersonation only and never reaches Strapi', async () => {
  const logout = await run({ method: 'POST', path: '/admin/logout' });
  assert.equal(logout.nextCalled, false);
  assert.deepEqual(logout.ctx.body, { data: {} });
  assert.deepEqual(logout.calls.ended, [['imp1', { reason: 'ended', endedBy: '1' }]]);
});

test('guard: ended or expired impersonations answer 401; lookup failure 503', async () => {
  const ended = await run({
    impersonation: { id: 'imp1', state: 'ended', expiresAt: Date.now() + 1000 },
  });
  assert.equal(ended.ctx.status, 401);
  assert.equal(ended.nextCalled, false);
  const unknown = await run({ impersonationId: 'unknown' });
  assert.equal(unknown.ctx.status, 401);
  const expired = await run({
    impersonation: { id: 'imp1', actorId: '1', state: 'active', expiresAt: Date.now() - 1 },
  });
  assert.equal(expired.ctx.status, 401);
  assert.equal(expired.calls.ended[0][1].reason, 'expired');
  const endedLogout = await run({
    method: 'POST',
    path: '/admin/logout',
    impersonation: { id: 'imp1', state: 'ended', expiresAt: 0 },
  });
  assert.deepEqual(endedLogout.ctx.body, { data: {} });
  assert.equal(endedLogout.nextCalled, false);
  const failed = await run({ lookupThrows: true });
  assert.equal(failed.ctx.status, 503);
});
