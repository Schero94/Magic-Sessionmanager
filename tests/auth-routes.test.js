'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyJwtIssuingRequest,
  isFailedLoginTrackedPath,
  shouldRunPreAuthGeoGuard,
} = require('../server/src/utils/auth-routes');

test('classifies every supported Strapi JWT-issuing route', () => {
  const newSessionRoutes = [
    ['/api/auth/local', 'POST'],
    ['/api/auth/local/register', 'POST'],
    ['/api/auth/reset-password', 'POST'],
    ['/api/auth/email-confirmation', 'GET'],
    ['/api/auth/google/callback', 'GET'],
    ['/api/magic-link/login', 'POST'],
    ['/api/magic-link/verify-mfa-totp', 'POST'],
    ['/api/magic-link/otp/verify', 'POST'],
    ['/api/passwordless/login', 'POST'],
  ];

  for (const [path, method] of newSessionRoutes) {
    assert.equal(classifyJwtIssuingRequest(path, method), 'new-session', `${method} ${path}`);
  }

  assert.equal(classifyJwtIssuingRequest('/api/auth/change-password', 'POST'), 'rotate-current');
  assert.equal(classifyJwtIssuingRequest('/api/auth/refresh', 'POST'), 'refresh');
  assert.equal(classifyJwtIssuingRequest('/api/articles', 'GET'), null);
});

test('pre-auth GeoIP guard covers new-session routes but not authenticated rotation', () => {
  assert.equal(shouldRunPreAuthGeoGuard('/api/auth/local/register', 'POST'), true);
  assert.equal(shouldRunPreAuthGeoGuard('/api/auth/reset-password', 'POST'), true);
  assert.equal(shouldRunPreAuthGeoGuard('/api/auth/google/callback', 'GET'), true);
  assert.equal(shouldRunPreAuthGeoGuard('/api/auth/change-password', 'POST'), false);
  assert.equal(shouldRunPreAuthGeoGuard('/api/auth/refresh', 'POST'), false);
});

test('failed-login lockout only counts credential verification routes', () => {
  // Users & Permissions' POST /auth/local is counted inside auth.callback
  // (security review 2, M1); the path table keeps only other plugins' routes.
  assert.equal(isFailedLoginTrackedPath('/api/auth/local', 'POST'), false);
  assert.equal(isFailedLoginTrackedPath('/api/magic-link/login-totp', 'POST'), true);
  assert.equal(isFailedLoginTrackedPath('/api/magic-link/login/challenge', 'GET'), true);
  assert.equal(isFailedLoginTrackedPath('/api/auth/local/register', 'POST'), false);
  assert.equal(isFailedLoginTrackedPath('/api/auth/reset-password', 'POST'), false);
});

test('GA-04: identifies only the successful-reset route as a password reset', () => {
  const { isPasswordResetRequest } = require('../server/src/utils/auth-routes');
  assert.equal(isPasswordResetRequest('/api/auth/reset-password', 'POST'), true);
  assert.equal(isPasswordResetRequest('/api/auth/reset-password', 'post'), true);
  assert.equal(isPasswordResetRequest('/api/auth/reset-password', 'GET'), false);
  assert.equal(isPasswordResetRequest('/api/auth/forgot-password', 'POST'), false);
  assert.equal(isPasswordResetRequest('/api/auth/local', 'POST'), false);
});

test('M1: every path spelling the router accepts maps to the canonical route', () => {
  const {
    toCanonicalApiPath,
    classifyJwtIssuingRequest,
  } = require('../server/src/utils/auth-routes');
  for (const variant of [
    '/api/auth/local/',
    '/API/auth/local',
    '/api/Auth/Local',
    '//api//auth/local',
  ]) {
    assert.equal(toCanonicalApiPath(variant, '/api'), '/api/auth/local', variant);
    assert.equal(
      classifyJwtIssuingRequest(toCanonicalApiPath(variant, '/api'), 'POST'),
      'new-session'
    );
  }
  assert.equal(toCanonicalApiPath('/V1/Auth/Local/', '/v1'), '/api/auth/local');
  assert.equal(
    isFailedLoginTrackedPath(toCanonicalApiPath('/API/magic-link/login-totp/', '/api'), 'POST'),
    true
  );
});
