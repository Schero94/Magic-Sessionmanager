'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { getNativeSessionManager } = require('../server/src/utils/native-session-manager');

const NATIVE_METHODS = [
  'validateAccessToken',
  'validateRefreshToken',
  'isSessionActive',
  'listSessions',
  'revokeSessionById',
  'invalidateRefreshToken',
];

function createStrapi({ mode = 'refresh', originManager, hasOrigin = true } = {}) {
  const nativeCalls = [];
  const manager = (origin) => {
    nativeCalls.push({ method: 'origin', args: [origin] });
    return originManager;
  };
  manager.hasOrigin = (origin) => {
    nativeCalls.push({ method: 'hasOrigin', args: [origin] });
    return hasOrigin;
  };

  return {
    nativeCalls,
    strapi: {
      config: {
        get(path, fallback) {
          assert.equal(path, 'plugin::users-permissions.jwtManagement');
          assert.equal(fallback, 'legacy-support');
          return mode;
        },
      },
      sessionManager: manager,
    },
  };
}

function createOriginManager(calls = []) {
  const manager = {};

  for (const method of NATIVE_METHODS) {
    manager[method] = function nativeMethod(...args) {
      calls.push({ method, args, receiver: this });
      const result = { method, args };
      return method === 'validateAccessToken' ? result : Promise.resolve(result);
    };
  }

  return { manager, calls };
}

test('legacy-support returns null without reading or calling the native manager', () => {
  const strapi = {
    config: {
      get(path, fallback) {
        assert.equal(path, 'plugin::users-permissions.jwtManagement');
        assert.equal(fallback, 'legacy-support');
        return 'legacy-support';
      },
    },
  };

  Object.defineProperty(strapi, 'sessionManager', {
    get() {
      assert.fail('legacy mode must not read strapi.sessionManager');
    },
  });

  assert.equal(getNativeSessionManager(strapi), null);
});

test('missing mode defaults to legacy-support without consulting native sessions', () => {
  const strapi = {
    config: { get: (_path, fallback) => fallback },
  };

  Object.defineProperty(strapi, 'sessionManager', {
    get() {
      assert.fail('the default legacy mode must not read strapi.sessionManager');
    },
  });

  assert.equal(getNativeSessionManager(strapi), null);
});

test('refresh mode defers manager and origin checks until a native operation', () => {
  const missingManager = createStrapi();
  delete missingManager.strapi.sessionManager;
  const missingManagerFacade = getNativeSessionManager(missingManager.strapi);
  assert.throws(
    () => missingManagerFacade.validateAccessToken('opaque-access-token'),
    /refresh.*strapi\.sessionManager/i
  );

  const missingOriginCheck = createStrapi();
  delete missingOriginCheck.strapi.sessionManager.hasOrigin;
  const missingOriginCheckFacade = getNativeSessionManager(missingOriginCheck.strapi);
  assert.throws(
    () => missingOriginCheckFacade.validateAccessToken('opaque-access-token'),
    /hasOrigin.*users-permissions/i
  );
});

test('a missing users-permissions origin fails closed on a native session operation', () => {
  const unregisteredOrigin = createStrapi({ hasOrigin: false });
  const facade = getNativeSessionManager(unregisteredOrigin.strapi);
  assert.throws(() => facade.listSessions('17'), /users-permissions.*origin/i);
  assert.deepEqual(unregisteredOrigin.nativeCalls, [
    { method: 'hasOrigin', args: ['users-permissions'] },
  ]);
});

test('an origin registered after Magic bootstrap is resolved on the later native operation', async () => {
  const { manager } = createOriginManager();
  const { strapi, nativeCalls } = createStrapi({
    originManager: manager,
    hasOrigin: false,
  });
  const nativeSessionManager = strapi.sessionManager;
  const facade = getNativeSessionManager(strapi);

  assert.deepEqual(nativeCalls, []);

  nativeSessionManager.hasOrigin = (origin) => {
    nativeCalls.push({ method: 'hasOrigin', args: [origin] });
    return true;
  };

  assert.deepEqual(await facade.listSessions('17'), {
    method: 'listSessions',
    args: ['17'],
  });
  assert.deepEqual(nativeCalls, [
    { method: 'hasOrigin', args: ['users-permissions'] },
    { method: 'origin', args: ['users-permissions'] },
  ]);
});

test('refresh mode returns a frozen facade delegating only the approved native methods', async () => {
  const calls = [];
  const { manager, calls: recordedCalls } = createOriginManager(calls);
  const { strapi, nativeCalls } = createStrapi({ originManager: manager });
  const nativeSessionManager = strapi.sessionManager;
  strapi.log = new Proxy(
    {},
    {
      get(_target, method) {
        return () => assert.fail(`native adapter must not write to strapi.log.${String(method)}`);
      },
    }
  );

  let managerReads = 0;
  Object.defineProperty(strapi, 'sessionManager', {
    configurable: true,
    get() {
      managerReads += 1;
      return nativeSessionManager;
    },
  });

  const facade = getNativeSessionManager(strapi);

  assert.deepEqual(Object.keys(facade).sort(), [...NATIVE_METHODS].sort());
  assert.equal(Object.isFrozen(facade), true);
  assert.equal(managerReads, 0);
  assert.deepEqual(nativeCalls, []);

  const inputs = {
    validateAccessToken: ['opaque-access-token'],
    validateRefreshToken: ['opaque-refresh-token'],
    isSessionActive: ['native-session-id'],
    listSessions: ['17'],
    revokeSessionById: ['17', 'native-session-id'],
    invalidateRefreshToken: ['17', 'device-id'],
  };

  for (const method of NATIVE_METHODS) {
    assert.equal(typeof facade[method], 'function');
    assert.deepEqual(await facade[method](...inputs[method]), {
      method,
      args: inputs[method],
    });
  }

  assert.equal(managerReads, NATIVE_METHODS.length);
  assert.equal(nativeCalls.length, NATIVE_METHODS.length * 2);
  for (let index = 0; index < nativeCalls.length; index += 2) {
    assert.deepEqual(nativeCalls[index], {
      method: 'hasOrigin',
      args: ['users-permissions'],
    });
    assert.deepEqual(nativeCalls[index + 1], {
      method: 'origin',
      args: ['users-permissions'],
    });
  }

  assert.equal(recordedCalls.length, NATIVE_METHODS.length);
  for (const [index, method] of NATIVE_METHODS.entries()) {
    assert.equal(recordedCalls[index].method, method);
    assert.deepEqual(recordedCalls[index].args, inputs[method]);
    assert.equal(recordedCalls[index].receiver, manager);
  }
});

test('refresh mode fails closed when the origin-scoped manager or any required method is missing', () => {
  const { strapi: missingOriginManager } = createStrapi({ originManager: null });
  const missingOriginManagerFacade = getNativeSessionManager(missingOriginManager);
  assert.throws(() => missingOriginManagerFacade.listSessions('17'), /origin-scoped.*manager/i);

  for (const missingMethod of NATIVE_METHODS) {
    const { manager } = createOriginManager();
    delete manager[missingMethod];
    const { strapi } = createStrapi({ originManager: manager });
    const facade = getNativeSessionManager(strapi);

    assert.throws(() => facade[missingMethod]('17'), new RegExp(missingMethod));
  }
});

test('unknown JWT management modes fail closed rather than selecting legacy behavior', () => {
  const { strapi } = createStrapi({ mode: 'unexpected-mode' });

  assert.throws(
    () => getNativeSessionManager(strapi),
    /unsupported.*jwtManagement.*unexpected-mode/i
  );
});
