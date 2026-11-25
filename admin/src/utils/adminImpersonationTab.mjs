/**
 * The impersonation tab of "Sign in as this admin" (4.23).
 *
 * Strapi's admin keeps one access token for every tab of a browser: it reads
 * `localStorage.jwtToken`, then the access cookie (`getStoredToken` in
 * `@strapi/admin/dist/admin/admin/src/reducer.mjs`, `getToken` in
 * `utils/getFetchClient.mjs`), and renews it with `POST /admin/access-token`
 * through the global `fetch` and the shared httpOnly refresh cookie. There is
 * no public setter and no per-tab storage (checked in 5.50.0, 5.58.0 and
 * 5.64.0, 2026-11-25).
 *
 * So the plugin isolates one tab itself, and only while that tab's own
 * `sessionStorage` holds an impersonation (sessionStorage belongs to one tab):
 * - reads of `jwtToken` and `isLoggedIn` from localStorage answer with the
 *   impersonation token, and writes to them are dropped, so the other tabs
 *   keep the real admin;
 * - `document.cookie` hides the access cookie and drops writes to it;
 * - `fetch` never sends `POST /admin/access-token` (the tab must never use
 *   or rotate the real admin's refresh cookie: it answers 401, so the token
 *   simply runs out), never signs in, and turns `POST /admin/logout` into
 *   "end this impersonation".
 *
 * It is installed when the plugin's admin module loads, before Strapi reads
 * the token (`renderAdmin` runs plugin `register`, then `bootstrap`, then
 * `StrapiApp.render`, which calls `getStoredToken`). The server enforces
 * everything that matters (read-only, identity routes, expiry, ending); this
 * shim only keeps the tabs apart.
 */

/** sessionStorage key of the tab state. */
export const TAB_STATE_KEY = 'magic-sessionmanager.admin-impersonation';

/** Admin path the start dialog opens in a new tab. */
export const LANDING_PATH = '/plugins/magic-sessionmanager/impersonate/land';

/** Hand-off code shape (server: CODE_PATTERN). */
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** RFC 6265 cookie-name characters. */
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,64}$/;

/** localStorage keys of Strapi's admin auth that the tab keeps to itself. */
const TOKEN_KEY = 'jwtToken';
const STATUS_KEY = 'isLoggedIn';

/**
 * Reads the tab state.
 *
 * @param {Window} win Window.
 * @returns {null|{phase: 'landing'|'active'|'ended'|'failed', token?: string, expiresAt?: string,
 *   cookieName?: string, code?: string, impersonation?: {id: string, allowChanges: boolean,
 *   targetName: string, actorName: string, expiresAt: string}, reason?: string}}
 */
export function readTabState(win) {
  try {
    const raw = win.sessionStorage.getItem(TAB_STATE_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' && typeof value.phase === 'string' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Writes the tab state (sessionStorage: this tab only).
 *
 * @param {Window} win Window.
 * @param {object|null} state New state, or null to remove it.
 * @returns {void}
 */
export function writeTabState(win, state) {
  try {
    if (state) win.sessionStorage.setItem(TAB_STATE_KEY, JSON.stringify(state));
    else win.sessionStorage.removeItem(TAB_STATE_KEY);
  } catch {
    // Storage disabled: the tab cannot impersonate.
  }
}

/**
 * The admin base path of a landing URL (`/admin` for `/admin/plugins/...`).
 *
 * @param {string} pathname `location.pathname`.
 * @returns {string|null} Base path, or null when the path is not the landing page.
 */
export function landingBase(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '');
  if (!path.endsWith(LANDING_PATH)) return null;
  return path.slice(0, path.length - LANDING_PATH.length);
}

/**
 * Parses the hash of the landing URL: `#code=<code>&c=<cookie name>`.
 *
 * @param {string} hash `location.hash`.
 * @returns {{code: string, cookieName: string}|null}
 */
export function parseLandingHash(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const code = params.get('code') || '';
  const cookieName = params.get('c') || 'jwtToken';
  if (!CODE_PATTERN.test(code) || !COOKIE_NAME_PATTERN.test(cookieName)) return null;
  return { code, cookieName };
}

/**
 * The landing URL of a hand-off.
 *
 * @param {string} adminBase Admin base path, e.g. `/admin`.
 * @param {{code: string, cookieName?: string}} handoff Code and access cookie name.
 * @returns {string} Path with hash.
 */
export function landingUrl(adminBase, handoff) {
  const params = new URLSearchParams({ code: handoff.code, c: handoff.cookieName || 'jwtToken' });
  return `${String(adminBase || '').replace(/\/+$/, '')}${LANDING_PATH}#${params.toString()}`;
}

/**
 * Value of one cookie in a `document.cookie` string.
 *
 * @param {string} cookies Cookie string.
 * @param {string} name Cookie name.
 * @returns {string|null}
 */
export function cookieValue(cookies, name) {
  let result = null;
  for (const part of String(cookies || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        result = decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        result = null;
      }
    }
  }
  return result;
}

/**
 * A cookie string without the named cookie.
 *
 * @param {string} cookies Cookie string.
 * @param {string} name Cookie name.
 * @returns {string}
 */
export function withoutCookie(cookies, name) {
  return String(cookies || '')
    .split(';')
    .filter((part) => part.split('=')[0].trim() !== name && part.trim() !== '')
    .map((part) => part.trim())
    .join('; ');
}

/**
 * The real admin's access token as Strapi stores it (localStorage, then the
 * access cookie), read before the shim is installed.
 *
 * @param {Window} win Window.
 * @param {string} cookieName Access cookie name.
 * @returns {string|null}
 */
export function readRealToken(win, cookieName) {
  try {
    const stored = win.localStorage.getItem(TOKEN_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // Fall back to the cookie.
  }
  try {
    return cookieValue(win.document.cookie, cookieName);
  } catch {
    return null;
  }
}

/**
 * Admin API path of a fetch input, or null when it cannot be parsed.
 *
 * @param {Window} win Window.
 * @param {RequestInfo|URL} input Fetch input.
 * @returns {string|null}
 */
function pathOf(win, input) {
  try {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
    return new URL(url, win.location.href).pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * A JSON response built in the tab.
 *
 * @param {Window} win Window.
 * @param {number} status HTTP status.
 * @param {object} body Body.
 * @returns {Response}
 */
function jsonResponse(win, status, body) {
  return new win.Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Installs the tab shim once. Every hook reads the current tab state, so
 * ending the impersonation takes effect without a reload.
 *
 * @param {Window & {__msmImpersonationShim?: boolean}} win Window.
 * @param {{onLogout?: () => void}} [hooks] Called when Strapi logs this tab out.
 * @returns {boolean} Whether the shim was installed by this call.
 * @sideeffect Wraps `Storage.prototype` get/set/remove, `document.cookie` and `fetch` of
 *   this window.
 */
export function installTabShim(win, hooks = {}) {
  if (win.__msmImpersonationShim) return false;
  win.__msmImpersonationShim = true;
  const localStore = win.localStorage;
  const proto = win.Storage.prototype;
  const original = {
    getItem: proto.getItem,
    setItem: proto.setItem,
    removeItem: proto.removeItem,
  };
  // Only while this tab holds an impersonation state; without it (after
  // "Back to my admin panel") the tab reads the shared storage again.
  const shadowed = (store, key) =>
    store === localStore && (key === TOKEN_KEY || key === STATUS_KEY) && readTabState(win) !== null;

  proto.getItem = function getItem(key) {
    if (shadowed(this, key)) {
      const state = readTabState(win);
      const active = state?.phase === 'active' && typeof state.token === 'string';
      if (key === TOKEN_KEY) return active ? JSON.stringify(state.token) : null;
      return active ? 'true' : null;
    }
    return original.getItem.call(this, key);
  };
  proto.setItem = function setItem(key, value) {
    if (shadowed(this, key)) return undefined;
    return original.setItem.call(this, key, value);
  };
  proto.removeItem = function removeItem(key) {
    if (shadowed(this, key)) return undefined;
    return original.removeItem.call(this, key);
  };

  const cookieName = () => readTabState(win)?.cookieName || 'jwtToken';
  const descriptor = Object.getOwnPropertyDescriptor(win.Document.prototype, 'cookie');
  if (descriptor?.get && descriptor?.set) {
    Object.defineProperty(win.document, 'cookie', {
      configurable: true,
      get() {
        const raw = descriptor.get.call(win.document);
        return readTabState(win) ? withoutCookie(raw, cookieName()) : raw;
      },
      set(value) {
        if (readTabState(win) && String(value).trim().startsWith(`${cookieName()}=`)) return;
        descriptor.set.call(win.document, value);
      },
    });
  }

  const originalFetch = win.fetch.bind(win);
  win.fetch = async (input, init) => {
    if (!readTabState(win)) return originalFetch(input, init);
    const path = pathOf(win, input) || '';
    if (/\/admin\/access-token$/.test(path)) {
      return jsonResponse(win, 401, {
        data: null,
        error: {
          status: 401,
          name: 'UnauthorizedError',
          message: 'An impersonation is not renewed',
          details: {},
        },
      });
    }
    if (/\/admin\/(login|register|register-admin|forgot-password|reset-password)$/.test(path)) {
      return jsonResponse(win, 403, {
        data: null,
        error: {
          status: 403,
          name: 'ForbiddenError',
          message: 'Not available in an impersonation tab',
          details: {},
        },
      });
    }
    if (/\/admin\/logout$/.test(path)) {
      hooks.onLogout?.();
      return jsonResponse(win, 200, { data: {} });
    }
    return originalFetch(input, init);
  };
  return true;
}
