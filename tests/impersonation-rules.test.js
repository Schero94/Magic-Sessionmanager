'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyRestrictedRequest,
  cleanReason,
  decodeJwtPayload,
  isRestrictedGraphqlRequest,
  normalizeImpersonationSettings,
  resolveFrontendHandoff,
  validateImpersonationConfig,
  validateImpersonationSettings,
  validateStartBody,
} = require('../server/src/utils/impersonation-rules');
const configModule = require('../server/src/config');
const { PROTECTED_SETTINGS_KEYS } = require('../server/src/utils/settings-access');
const {
  SECURITY_EVENTS,
  KEEP_WITHOUT_ACTOR_EVENTS,
} = require('../server/src/utils/security-log-model');

const prod = { production: true };
const dev = { production: false };

test('the feature switch is off unless stored as true, and it is a protected setting', () => {
  assert.deepEqual(normalizeImpersonationSettings(undefined), { impersonationEnabled: false });
  assert.deepEqual(normalizeImpersonationSettings({ impersonationEnabled: 'true' }), {
    impersonationEnabled: false,
  });
  assert.deepEqual(normalizeImpersonationSettings({ impersonationEnabled: true }), {
    impersonationEnabled: true,
  });
  assert.deepEqual(validateImpersonationSettings({ impersonationEnabled: 1 }).errors[0].path, [
    'impersonationEnabled',
  ]);
  assert.deepEqual(validateImpersonationSettings({}).values, {});
  assert.ok(PROTECTED_SETTINGS_KEYS.includes('impersonationEnabled'));
});

test('restricted Content API requests while impersonating', () => {
  const cases = [
    ['POST', '/api/auth/change-password', 'credentials'],
    ['POST', '/api/auth/reset-password', 'credentials'],
    ['POST', '/api/auth/forgot-password', 'credentials'],
    ['POST', '/api/auth/send-email-confirmation', 'credentials'],
    ['GET', '/api/auth/email-confirmation', 'credentials'],
    ['POST', '/api/auth/local', 'credentials'],
    ['POST', '/api/auth/local/register', 'credentials'],
    ['GET', '/api/auth/github/callback', 'credentials'],
    ['GET', '/api/connect/github', 'credentials'],
    ['POST', '/api/auth/logout', 'sessions'],
    ['DELETE', '/api/auth/sessions/abc', 'sessions'],
    ['PUT', '/api/users/1', 'account'],
    ['DELETE', '/api/users/1', 'account'],
    ['POST', '/api/users', 'account'],
    ['POST', '/api/magic-sessionmanager/logout', 'sessions'],
    ['POST', '/api/magic-sessionmanager/logout-all', 'sessions'],
    ['POST', '/api/magic-sessionmanager/logout-others', 'sessions'],
    ['DELETE', '/api/magic-sessionmanager/my-sessions/x', 'sessions'],
    ['POST', '/api/magic-sessionmanager/impersonation/exchange', 'sessions'],
    ['GET', '/api/magic-sessionmanager/my-data', 'account'],
    ['GET', '/api/magic-sessionmanager/not-me', 'account'],
    ['POST', '/api/magic-sessionmanager/not-me', 'account'],
    ['POST', '/api/magic-link/send-link', 'credentials'],
    ['GET', '/api/passwordless/login', 'credentials'],
    // Case, double slashes and a trailing slash do not bypass a rule.
    ['POST', '/API//Auth/Change-Password/', 'credentials'],
  ];
  for (const [method, path, expected] of cases) {
    assert.equal(classifyRestrictedRequest(method, path), expected, `${method} ${path}`);
  }
  const allowed = [
    ['POST', '/api/auth/refresh'],
    ['GET', '/api/auth/sessions'],
    ['GET', '/api/users/me'],
    ['GET', '/api/users/1'],
    ['GET', '/api/magic-sessionmanager/my-sessions'],
    ['GET', '/api/magic-sessionmanager/current-session'],
    ['GET', '/api/magic-sessionmanager/user/abc/sessions'],
    ['POST', '/api/orders'],
    ['DELETE', '/api/carts/1'],
    ['GET', '/admin/users/me'],
    ['POST', '/apiary/auth/local'],
  ];
  for (const [method, path] of allowed) {
    assert.equal(classifyRestrictedRequest(method, path), null, `${method} ${path}`);
  }
  // A custom REST prefix moves the rules with it.
  assert.equal(classifyRestrictedRequest('POST', '/rest/auth/local', '/rest'), 'credentials');
  assert.equal(classifyRestrictedRequest('POST', '/api/auth/local', '/rest'), null);
});

test('GraphQL mutations that sign in or change the account are restricted', () => {
  assert.equal(
    isRestrictedGraphqlRequest({ query: 'mutation { changePassword(x: 1) { jwt } }' }),
    true
  );
  assert.equal(
    isRestrictedGraphqlRequest({
      query: 'mutation Up { updateUsersPermissionsUser(id: 1) { data { id } } }',
    }),
    true
  );
  assert.equal(
    isRestrictedGraphqlRequest([
      { query: 'query { me { id } }' },
      { query: 'mutation { login(input: {}) { jwt } }' },
    ]),
    true
  );
  assert.equal(isRestrictedGraphqlRequest({ query: 'query { me { id username } }' }), false);
  assert.equal(
    isRestrictedGraphqlRequest({ query: 'mutation { createOrder(data: {}) { documentId } }' }),
    false
  );
  assert.equal(isRestrictedGraphqlRequest(null, 'mutation { register(input: {}) { jwt } }'), true);
  assert.equal(
    isRestrictedGraphqlRequest({ query: `query { a } ${'#'.repeat(110 * 1024)}` }),
    true
  );
  const started = Date.now();
  isRestrictedGraphqlRequest({ query: `mutation ${'login'.repeat(20000)}` });
  assert.ok(Date.now() - started < 200, 'linear time on adversarial input');
});

test('start requests: reason 3 to 255 characters, fixed durations, no unknown fields', () => {
  const options = { durations: [15, 30, 60], notify: true };
  const ok = validateStartBody(
    { reason: '  Ticket\n4711  ', durationMinutes: 30, notifyUser: true },
    options
  );
  assert.deepEqual(ok.value, { reason: 'Ticket 4711', durationMinutes: 30, notifyUser: true });
  const paths = (body) => validateStartBody(body, options).errors.map((error) => error.path[0]);
  assert.deepEqual(paths({ reason: 'ab', durationMinutes: 15 }), ['reason']);
  assert.deepEqual(paths({ reason: 'x'.repeat(256), durationMinutes: 15 }), ['reason']);
  assert.deepEqual(paths({ reason: 'Ticket', durationMinutes: '15' }), ['durationMinutes']);
  assert.deepEqual(paths({ reason: 'Ticket', durationMinutes: 120 }), ['durationMinutes']);
  assert.deepEqual(paths({ reason: 'Ticket', durationMinutes: 15, userId: 1 }), ['userId']);
  assert.deepEqual(paths({ reason: 'Ticket', durationMinutes: 15, notifyUser: 'y' }), [
    'notifyUser',
  ]);
  assert.deepEqual(paths([]), [undefined]);
  assert.equal(
    validateStartBody(
      { reason: 'Ticket', durationMinutes: 15, notifyUser: true },
      {
        durations: [15],
        notify: false,
      }
    ).value,
    null
  );
  assert.equal(cleanReason('\u0000\u0007ab\u0000'), null);
});

test('frontend hand-off config: https on the allow-list, never user info, query or fragment', () => {
  assert.doesNotThrow(() => validateImpersonationConfig(undefined, prod));
  assert.doesNotThrow(() =>
    validateImpersonationConfig({ frontendUrl: 'https://app.example.test/impersonate' }, prod)
  );
  assert.doesNotThrow(() =>
    validateImpersonationConfig(
      {
        frontendUrl: 'https://app.example.test/impersonate',
        allowedFrontendOrigins: ['https://app.example.test'],
      },
      prod
    )
  );
  const invalid = [
    { frontendUrl: 'http://app.example.test/impersonate' },
    { frontendUrl: 'https://user:pass@app.example.test/x' },
    { frontendUrl: 'https://app.example.test/x?next=1' },
    { frontendUrl: 'https://app.example.test/x#frag' },
    { frontendUrl: 'javascript:alert(1)' },
    {
      frontendUrl: 'https://evil.example.test/x',
      allowedFrontendOrigins: ['https://app.example.test'],
    },
    { allowedFrontendOrigins: ['https://app.example.test/path'] },
    { frontendUrl: 'https://app.example.test', extra: true },
  ];
  for (const config of invalid) {
    assert.throws(() => validateImpersonationConfig(config, prod), Error, JSON.stringify(config));
  }
  // Loopback http only outside production.
  assert.doesNotThrow(() =>
    validateImpersonationConfig({ frontendUrl: 'http://localhost:3000/impersonate' }, dev)
  );
  assert.throws(() =>
    validateImpersonationConfig({ frontendUrl: 'http://localhost:3000/impersonate' }, prod)
  );
  assert.equal(resolveFrontendHandoff({ frontendUrl: 'http://evil.example/x' }, prod), null);
  assert.deepEqual(resolveFrontendHandoff({ frontendUrl: 'https://app.example.test/i' }, prod), {
    url: 'https://app.example.test/i',
    origin: 'https://app.example.test',
  });
  // The plugin config validator applies the same rules at boot.
  assert.throws(() => configModule.validator({ impersonation: { frontendUrl: 'ftp://x' } }));
});

test('JWT payloads are read without trusting them', () => {
  const token = ['e30', Buffer.from('{"msmImp":"abc","id":1}').toString('base64url'), 'sig'].join(
    '.'
  );
  assert.deepEqual(decodeJwtPayload(token), { msmImp: 'abc', id: 1 });
  assert.equal(decodeJwtPayload('not-a-token'), null);
  assert.equal(decodeJwtPayload(`a.${'x'.repeat(9000)}.c`), null);
  assert.equal(
    decodeJwtPayload(['e30', Buffer.from('[1]').toString('base64url'), 's'].join('.')),
    null
  );
});

test('impersonation events are registered and outlive the admin who started them', () => {
  for (const key of [
    'IMPERSONATION_STARTED',
    'IMPERSONATION_ENDED',
    'IMPERSONATION_EXPIRED',
    'IMPERSONATION_REFUSED',
  ]) {
    assert.ok(SECURITY_EVENTS[key].startsWith('impersonation.'));
    assert.ok(KEEP_WITHOUT_ACTOR_EVENTS.includes(SECURITY_EVENTS[key]));
  }
});

test('start-up check: the frontend origin must be allowed by the CSP form-action', () => {
  const createService = require('../server/src/services/impersonation');
  const warnings = [];
  const fakeStrapi = (middlewares, impersonation) => ({
    config: {
      get: (key) =>
        key === 'middlewares'
          ? middlewares
          : key === 'plugin::magic-sessionmanager.impersonation'
            ? impersonation
            : key === 'plugin::magic-sessionmanager'
              ? { debug: false }
              : undefined,
    },
    log: { warn: (message) => warnings.push(String(message)), info() {}, error() {}, debug() {} },
  });
  const frontend = { frontendUrl: 'https://app.example.test/impersonate' };
  const without = createService({ strapi: fakeStrapi(['strapi::security'], frontend) });
  assert.equal(without.checkHandoffSetup(), false);
  assert.ok(warnings.some((message) => message.includes('form-action')));
  const allowed = createService({
    strapi: fakeStrapi(
      [
        {
          name: 'strapi::security',
          config: {
            contentSecurityPolicy: {
              directives: { 'form-action': ["'self'", 'https://app.example.test'] },
            },
          },
        },
      ],
      frontend
    ),
  });
  assert.equal(allowed.checkHandoffSetup(), true);
  const noFrontend = createService({ strapi: fakeStrapi(['strapi::security'], undefined) });
  assert.equal(noFrontend.checkHandoffSetup(), true);
});
