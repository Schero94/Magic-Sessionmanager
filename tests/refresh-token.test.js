'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getIncomingRefreshToken,
  getOutgoingRefreshToken,
  stripAuthTokensFromResponse,
} = require('../server/src/utils/refresh-token');

test('reads an incoming refresh token from the request body', () => {
  const ctx = {
    request: { body: { refreshToken: 'body-refresh' } },
    cookies: { get: () => 'cookie-refresh' },
  };

  assert.equal(getIncomingRefreshToken(ctx, 'strapi_up_refresh'), 'body-refresh');
});

test('reads an incoming refresh token from the HttpOnly cookie', () => {
  const ctx = {
    request: { body: {} },
    cookies: {
      get(name) {
        assert.equal(name, 'strapi_up_refresh');
        return 'cookie-refresh';
      },
    },
  };

  assert.equal(getIncomingRefreshToken(ctx, 'strapi_up_refresh'), 'cookie-refresh');
});

test('reads a rotated refresh token from Set-Cookie', () => {
  const ctx = {
    body: { jwt: 'new-access' },
    response: {
      headers: {
        'set-cookie': [
          'other=value; Path=/',
          'strapi_up_refresh=cookie-refresh%2Evalue; Path=/; HttpOnly; SameSite=Lax',
        ],
      },
    },
  };

  assert.equal(getOutgoingRefreshToken(ctx, 'strapi_up_refresh'), 'cookie-refresh.value');
});

test('strips access and refresh tokens from body and Set-Cookie', () => {
  const headers = {
    'set-cookie': [
      'strapi_up_refresh=secret; Path=/; HttpOnly',
      'locale=de; Path=/',
    ],
  };
  const ctx = {
    body: { jwt: 'access', refreshToken: 'refresh', user: { id: 1 } },
    response: { headers },
    remove(name) {
      delete headers[name.toLowerCase()];
    },
    append(name, value) {
      const key = name.toLowerCase();
      headers[key] = headers[key]
        ? [].concat(headers[key], value)
        : value;
    },
  };

  stripAuthTokensFromResponse(ctx, 'strapi_up_refresh');

  assert.deepEqual(ctx.body, { user: { id: 1 } });
  assert.deepEqual([].concat(headers['set-cookie']), ['locale=de; Path=/']);
});
