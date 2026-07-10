'use strict';

const NEW_SESSION_ROUTES = new Set([
  'POST /api/auth/local',
  'POST /api/auth/local/register',
  'POST /api/auth/reset-password',
  'GET /api/auth/email-confirmation',
  'POST /api/auth/email-confirmation',
  'POST /api/magic-link/verify-mfa-totp',
  'POST /api/magic-link/otp/verify',
  'POST /api/magic-link/login-totp',
]);

const FAILED_LOGIN_ROUTES = new Set([
  'POST /api/auth/local',
  'POST /api/magic-link/login-totp',
  'POST /api/magic-link/otp/verify',
  'POST /api/magic-link/verify-mfa-totp',
]);

function requestKey(path, method) {
  return `${String(method || '').toUpperCase()} ${path || ''}`;
}

function isMagicLinkLogin(path, method) {
  const normalizedMethod = String(method || '').toUpperCase();
  return (
    typeof path === 'string' &&
    path.startsWith('/api/magic-link/login') &&
    (normalizedMethod === 'GET' || normalizedMethod === 'POST')
  );
}

function classifyJwtIssuingRequest(path, method) {
  const normalizedMethod = String(method || '').toUpperCase();
  const key = requestKey(path, normalizedMethod);

  if (key === 'POST /api/auth/refresh') return 'refresh';
  if (key === 'POST /api/auth/change-password') return 'rotate-current';
  if (NEW_SESSION_ROUTES.has(key)) return 'new-session';

  if (
    normalizedMethod === 'GET' &&
    /^\/api\/auth\/[a-z0-9-]+\/callback$/i.test(path || '')
  ) {
    return 'new-session';
  }

  if (isMagicLinkLogin(path, normalizedMethod)) return 'new-session';

  if (
    typeof path === 'string' &&
    path.startsWith('/api/passwordless/') &&
    (normalizedMethod === 'GET' || normalizedMethod === 'POST')
  ) {
    return 'new-session';
  }

  return null;
}

function shouldRunPreAuthGeoGuard(path, method) {
  return classifyJwtIssuingRequest(path, method) === 'new-session';
}

function isFailedLoginTrackedPath(path, method) {
  return FAILED_LOGIN_ROUTES.has(requestKey(path, method)) || isMagicLinkLogin(path, method);
}

module.exports = {
  classifyJwtIssuingRequest,
  isFailedLoginTrackedPath,
  shouldRunPreAuthGeoGuard,
};
