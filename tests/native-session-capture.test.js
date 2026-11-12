'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CREATED_STATE_KEY,
  MAX_PARSED_BODY_BYTES,
  MAX_RECORDED_PER_REQUEST,
  findAccessTokenCandidates,
  getCreatedNativeSessions,
  recordCreatedNativeSession,
  revokeCreatedNativeSessions,
  subscribeNativeSessionCreation,
} = require('../server/src/utils/native-session-capture');
const { normalizeApiPrefix, toCanonicalApiPath } = require('../server/src/utils/auth-routes');

const activeRow = (sessionId, userId = 7, extra = {}) => ({
  sessionId,
  userId,
  origin: 'users-permissions',
  status: 'active',
  ...extra,
});

test('records Users & Permissions sessions on the request that created them', () => {
  const ctx = { state: {} };
  const strapi = { requestContext: { get: () => ctx } };
  assert.equal(recordCreatedNativeSession(strapi, activeRow('a')), true);
  assert.equal(
    recordCreatedNativeSession(strapi, activeRow('admin-1', 1, { origin: 'admin' })),
    false
  );
  assert.equal(recordCreatedNativeSession(strapi, activeRow('r', 1, { status: 'rotated' })), false);
  assert.equal(recordCreatedNativeSession(strapi, activeRow('', 1)), false);
  assert.equal(recordCreatedNativeSession(strapi, { ...activeRow('n'), userId: null }), false);
  assert.deepEqual(getCreatedNativeSessions(ctx), [{ sessionId: 'a', userId: '7' }]);
});

test('records nothing outside a request and caps the list per request', () => {
  assert.equal(
    recordCreatedNativeSession({ requestContext: { get: () => undefined } }, activeRow('x')),
    false
  );
  assert.equal(recordCreatedNativeSession({}, activeRow('x')), false);
  const throwing = {
    requestContext: {
      get: () => {
        throw new Error('no store');
      },
    },
  };
  assert.equal(recordCreatedNativeSession(throwing, activeRow('x')), false);

  const ctx = { state: {} };
  const strapi = { requestContext: { get: () => ctx } };
  for (let index = 0; index < MAX_RECORDED_PER_REQUEST + 5; index += 1) {
    recordCreatedNativeSession(strapi, activeRow(`s${index}`));
  }
  assert.equal(ctx.state[CREATED_STATE_KEY].length, MAX_RECORDED_PER_REQUEST);
});

test('subscribes one afterCreate hook on admin::session and returns its unsubscribe', () => {
  const subscribers = [];
  const ctx = { state: {} };
  const strapi = {
    contentTypes: { 'admin::session': {} },
    requestContext: { get: () => ctx },
    db: {
      lifecycles: {
        subscribe(subscriber) {
          subscribers.push(subscriber);
          return () => subscribers.splice(subscribers.indexOf(subscriber), 1);
        },
      },
    },
  };
  const unsubscribe = subscribeNativeSessionCreation(strapi);
  assert.equal(subscribers.length, 1);
  assert.deepEqual(subscribers[0].models, ['admin::session']);
  subscribers[0].afterCreate({ result: activeRow('hooked') });
  subscribers[0].afterCreate({ result: undefined });
  assert.deepEqual(getCreatedNativeSessions(ctx), [{ sessionId: 'hooked', userId: '7' }]);
  unsubscribe();
  assert.equal(subscribers.length, 0);

  assert.equal(typeof subscribeNativeSessionCreation({ db: {} }), 'function');
});

test('finds access tokens in REST and GraphQL response bodies, bounded', () => {
  assert.deepEqual(findAccessTokenCandidates({ jwt: 'rest-token', user: {} }), ['rest-token']);
  assert.deepEqual(
    findAccessTokenCandidates(JSON.stringify({ data: { login: { jwt: 'gql-token' } } })),
    ['gql-token']
  );
  assert.deepEqual(findAccessTokenCandidates({ data: [{ jwt: 'array' }] }), []);
  assert.deepEqual(findAccessTokenCandidates('not json'), []);
  assert.deepEqual(findAccessTokenCandidates(Buffer.from('{"jwt":"x"}')), []);
  assert.deepEqual(findAccessTokenCandidates({ pipe() {}, jwt: 'stream' }), []);
  const huge = JSON.stringify({ jwt: 'x', pad: 'p'.repeat(MAX_PARSED_BODY_BYTES) });
  assert.deepEqual(findAccessTokenCandidates(huge), []);
  const many = {
    data: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`m${i}`, { jwt: `t${i}` }])),
  };
  assert.equal(findAccessTokenCandidates(many).length, 10);
});

test('revokes only the sessions recorded on the request, except the excluded one', async () => {
  const ctx = {
    state: {
      [CREATED_STATE_KEY]: [
        { sessionId: 'a', userId: '1' },
        { sessionId: 'b', userId: '2' },
      ],
    },
  };
  const calls = [];
  const nativeSessionManager = {
    revokeSessionById: async (userId, sessionId) => {
      calls.push([userId, sessionId]);
      if (sessionId === 'b') throw new Error('synthetic failure');
      return true;
    },
  };
  const errors = [];
  const log = { error: (...args) => errors.push(args) };
  assert.equal(await revokeCreatedNativeSessions({ ctx, nativeSessionManager, log }), 1);
  assert.deepEqual(calls, [
    ['1', 'a'],
    ['2', 'b'],
  ]);
  assert.deepEqual(errors, [['[AUTH-COMPENSATION] Native session revocation failed:', 'Error']]);

  calls.length = 0;
  await revokeCreatedNativeSessions({ ctx, nativeSessionManager, log, except: 'a' });
  assert.deepEqual(calls, [['2', 'b']]);
});

test('maps a custom REST prefix to the /api route tables', () => {
  assert.equal(normalizeApiPrefix(undefined), '/api');
  assert.equal(normalizeApiPrefix('v1/'), '/v1');
  assert.equal(normalizeApiPrefix('  '), '/api');
  assert.equal(toCanonicalApiPath('/api/auth/local', '/api'), '/api/auth/local');
  assert.equal(toCanonicalApiPath('/v1/auth/local', '/v1'), '/api/auth/local');
  assert.equal(toCanonicalApiPath('/v1', '/v1/'), '/api');
  assert.equal(toCanonicalApiPath('/api/auth/local', '/v1'), null);
  assert.equal(toCanonicalApiPath('/v10/auth/local', '/v1'), null);
  assert.equal(toCanonicalApiPath(undefined, '/v1'), null);
});
