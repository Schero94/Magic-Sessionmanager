'use strict';

// Red-team review of impersonation (unit level). The real HTTP proofs are in
// tests/isolated-impersonation-redteam-http.test.js.
//
// F2: a sign-in as another admin needs every conditional permission of the
//     target held without conditions (conditions such as
//     `admin::is-creator` follow the signed-in identity).
// F3/F4: every guarded request re-checks the starter (active, still holds
//     the start action and plugin access, still signed in on the device that
//     started it) and, for an admin sign-in, the target (active, no Super
//     Admin, no wider than the starter). A failure ends the impersonation.

const test = require('node:test');
const assert = require('node:assert/strict');
const { uncoveredPermissions } = require('../server/src/utils/permission-subset');
const { asIdentity } = require('../server/src/utils/admin-preview');
const createService = require('../server/src/services/impersonation');

const ARTICLE = 'api::article.article';
const own = (action) => ({
  action: `plugin::content-manager.explorer.${action}`,
  subject: ARTICLE,
  properties: {},
  conditions: ['admin::is-creator'],
});
const all = (action) => ({ ...own(action), conditions: [] });

test('F2: own-entries permissions are covered for a preview but not for a sign-in', () => {
  const target = [own('read'), own('update')];
  const sameRole = [own('read'), own('update')];
  // Preview semantics (no session): the same condition covers it.
  assert.equal(uncoveredPermissions(target, sameRole).length, 0);
  // Sign-in semantics: the starter acts as the target, so "own" means the
  // target's entries; only an unconditional permission covers that.
  assert.equal(uncoveredPermissions(target.map(asIdentity), sameRole).length, 2);
  assert.equal(
    uncoveredPermissions(target.map(asIdentity), [all('read'), all('update')]).length,
    0
  );
  assert.equal(asIdentity(own('read')).conditions.length, 0);
  assert.equal(own('read').conditions.length, 1, 'input is not mutated');
});

/**
 * A fake Strapi for the authorization re-check.
 *
 * @param {object} state Admins, abilities and sessions.
 * @returns {{strapi: any, ended: any[]}}
 */
function fakeStrapi(state) {
  const ended = [];
  const impersonationRows = new Map();
  const strapi = {
    config: { get: () => undefined },
    log: { warn() {}, info() {}, error() {}, debug() {} },
    admin: {
      services: {
        permission: {
          engine: {
            generateUserAbility: async (user) => ({
              can: (action) => (state.abilities[user.id] || []).includes(action),
            }),
          },
          findUserPermissions: async (user) => state.permissions[user.id] || [],
          actionProvider: {
            has: () => true,
            appliesToProperty: async () => false,
          },
          conditionProvider: { has: () => true },
        },
      },
    },
    db: {
      query: (uid) => {
        if (uid === 'admin::user') {
          return { findOne: async ({ where }) => state.admins[where.id] || null };
        }
        if (uid === 'admin::session') {
          return {
            findOne: async ({ where }) => {
              state.sessionQueries.push(where);
              return (
                state.sessions.find(
                  (row) =>
                    row.userId === where.userId &&
                    row.status === 'active' &&
                    (!where.deviceId || row.deviceId === where.deviceId)
                ) || null
              );
            },
          };
        }
        return {
          findOne: async ({ where }) =>
            impersonationRows.get(where.documentId) || {
              id: 1,
              documentId: where.documentId,
              targetType: 'user',
              targetId: 'u1',
              actorId: '1',
              state: 'active',
            },
          updateMany: async ({ where }) => {
            ended.push(where.id);
            return { count: 1 };
          },
        };
      },
    },
    plugin: () => ({ service: () => ({ record() {} }) }),
  };
  return { strapi, ended };
}

const ACCESS = 'plugin::magic-sessionmanager.access';
const USERS = 'plugin::magic-sessionmanager.impersonate.users';
const SIGN_IN = 'plugin::magic-sessionmanager.impersonate.admins.sign-in';
const superRole = { id: 1, code: 'strapi-super-admin' };
const editorRole = { id: 2, code: 'editor' };

const baseState = () => ({
  admins: {
    1: { id: 1, isActive: true, roles: [editorRole] },
    3: { id: 3, isActive: true, roles: [editorRole] },
  },
  abilities: { 1: [ACCESS, USERS, SIGN_IN] },
  permissions: { 1: [all('read')], 3: [all('read')] },
  sessions: [{ userId: '1', deviceId: 'dev-1', status: 'active' }],
  sessionQueries: [],
});

test('F4: the starter must be active, hold the action and still be signed in', async () => {
  const user = { id: 'imp1', targetType: 'user', actorId: '1', actorDeviceId: 'dev-1' };
  const check = async (mutate) => {
    const state = baseState();
    mutate?.(state);
    const { strapi } = fakeStrapi(state);
    return createService({ strapi }).authorizationHolds(user);
  };
  assert.equal(await check(), true);
  assert.equal(
    await check((s) => {
      s.admins[1].isActive = false;
    }),
    false,
    'deactivated'
  );
  assert.equal(
    await check((s) => {
      delete s.admins[1];
    }),
    false,
    'deleted'
  );
  assert.equal(
    await check((s) => {
      s.abilities[1] = [ACCESS];
    }),
    false,
    'lost impersonate.users'
  );
  assert.equal(
    await check((s) => {
      s.abilities[1] = [USERS];
    }),
    false,
    'lost plugin access'
  );
  assert.equal(
    await check((s) => {
      s.sessions = [];
    }),
    false,
    'signed out'
  );
  assert.equal(
    await check((s) => {
      s.sessions = [{ userId: '1', deviceId: 'other', status: 'active' }];
    }),
    false,
    'signed out on the starting device'
  );
  // Without a recorded device any own session counts, but never a sign-in
  // someone else holds as the starter.
  const state = baseState();
  const { strapi } = fakeStrapi(state);
  assert.equal(
    await createService({ strapi }).authorizationHolds({ ...user, actorDeviceId: null }),
    true
  );
  assert.ok(state.sessionQueries[0].$or, 'excludes impersonation devices');
  assert.equal(state.sessionQueries[0].status, 'active');
});

test('F3: an admin sign-in ends when the target becomes wider or a Super Admin', async () => {
  const signIn = {
    id: 'imp2',
    targetType: 'admin',
    actorId: '1',
    actorDeviceId: 'dev-1',
    targetId: '3',
  };
  const check = async (mutate) => {
    const state = baseState();
    mutate?.(state);
    const { strapi } = fakeStrapi(state);
    return createService({ strapi }).authorizationHolds(signIn);
  };
  assert.equal(await check(), true);
  assert.equal(
    await check((s) => {
      s.admins[3].roles = [superRole];
    }),
    false,
    'promoted to Super Admin'
  );
  assert.equal(
    await check((s) => {
      s.permissions[3] = [all('read'), all('delete')];
    }),
    false,
    'gained a permission'
  );
  assert.equal(
    await check((s) => {
      s.admins[3].isActive = false;
    }),
    false,
    'target deactivated'
  );
  assert.equal(
    await check((s) => {
      s.abilities[1] = [ACCESS, USERS];
    }),
    false,
    'starter lost the sign-in action'
  );
});

test('stillAuthorized caches a pass for five seconds and ends on failure', async () => {
  const state = baseState();
  const { strapi, ended } = fakeStrapi(state);
  const service = createService({ strapi });
  const record = { id: 'imp3', targetType: 'user', actorId: '1', actorDeviceId: 'dev-1' };
  assert.equal(await service.stillAuthorized(record), true);
  state.admins[1].isActive = false;
  // Cached pass within the window.
  assert.equal(await service.stillAuthorized(record), true);
  assert.equal(ended.length, 0);
  const realNow = Date.now;
  Date.now = () => realNow() + 6000;
  try {
    assert.equal(await service.stillAuthorized(record), false);
  } finally {
    Date.now = realNow;
  }
  assert.equal(ended.length, 1);
});
