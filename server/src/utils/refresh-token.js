'use strict';

const DEFAULT_REFRESH_COOKIE_NAME = 'strapi_up_refresh';

function getRefreshCookieName(strapi) {
  try {
    return strapi.config.get(
      'plugin::users-permissions.sessions.cookie.name',
      DEFAULT_REFRESH_COOKIE_NAME
    ) || DEFAULT_REFRESH_COOKIE_NAME;
  } catch {
    return DEFAULT_REFRESH_COOKIE_NAME;
  }
}

function getIncomingRefreshToken(ctx, cookieName = DEFAULT_REFRESH_COOKIE_NAME) {
  const bodyToken = ctx?.request?.body?.refreshToken;
  if (typeof bodyToken === 'string' && bodyToken.length > 0) return bodyToken;

  try {
    const cookieToken = ctx?.cookies?.get(cookieName);
    return typeof cookieToken === 'string' && cookieToken.length > 0 ? cookieToken : null;
  } catch {
    return null;
  }
}

function getSetCookieHeaders(ctx) {
  const headers = ctx?.response?.headers || ctx?.response?.header || {};
  const raw = headers['set-cookie'] || headers['Set-Cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function parseCookieValue(header, cookieName) {
  if (typeof header !== 'string') return null;
  const firstPart = header.split(';', 1)[0].trim();
  const separator = firstPart.indexOf('=');
  if (separator < 1 || firstPart.slice(0, separator) !== cookieName) return null;

  const rawValue = firstPart.slice(separator + 1);
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

function getOutgoingRefreshToken(ctx, cookieName = DEFAULT_REFRESH_COOKIE_NAME) {
  const bodyToken = ctx?.body?.refreshToken;
  if (typeof bodyToken === 'string' && bodyToken.length > 0) return bodyToken;

  for (const header of getSetCookieHeaders(ctx)) {
    const value = parseCookieValue(header, cookieName);
    if (value) return value;
  }
  return null;
}

function stripAuthTokensFromResponse(ctx, cookieName = DEFAULT_REFRESH_COOKIE_NAME) {
  if (ctx?.body && typeof ctx.body === 'object' && !Buffer.isBuffer(ctx.body)) {
    delete ctx.body.jwt;
    delete ctx.body.refreshToken;
  }

  const remainingCookies = getSetCookieHeaders(ctx).filter(
    (header) => parseCookieValue(header, cookieName) === null
  );

  if (typeof ctx?.remove === 'function') {
    ctx.remove('Set-Cookie');
    for (const header of remainingCookies) {
      if (typeof ctx.append === 'function') ctx.append('Set-Cookie', header);
    }
    return;
  }

  const headers = ctx?.response?.headers || ctx?.response?.header;
  if (!headers) return;
  delete headers['Set-Cookie'];
  if (remainingCookies.length > 0) {
    headers['set-cookie'] = remainingCookies;
  } else {
    delete headers['set-cookie'];
  }
}

module.exports = {
  DEFAULT_REFRESH_COOKIE_NAME,
  getRefreshCookieName,
  getIncomingRefreshToken,
  getOutgoingRefreshToken,
  stripAuthTokensFromResponse,
};
