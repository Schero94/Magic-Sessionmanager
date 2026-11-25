// Sign in as this admin (4.23): the impersonation tab keeps the target's
// token to itself. Runs the shim in jsdom with Strapi's own storage
// contract (localStorage `jwtToken`/`isLoggedIn`, the access cookie, fetch
// to /admin/access-token and /admin/logout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  TAB_STATE_KEY,
  cookieValue,
  installTabShim,
  landingBase,
  landingUrl,
  parseLandingHash,
  readRealToken,
  readTabState,
  withoutCookie,
  writeTabState,
} from '../admin/src/utils/adminImpersonationTab.mjs';

const CODE = 'A'.repeat(43);

/**
 * A jsdom window with a fake network.
 *
 * @returns {{win: any, requests: string[]}}
 */
function makeWindow() {
  const dom = new JSDOM('<!doctype html><div id="strapi"></div>', {
    url: 'http://127.0.0.1:1621/admin/plugins/magic-sessionmanager/impersonate/land',
  });
  const win = dom.window;
  const requests = [];
  win.Response = globalThis.Response;
  win.fetch = async (input) => {
    requests.push(String(input));
    return new Response('{}', { status: 200 });
  };
  return { win, requests };
}

test('landing URL: code and cookie name travel in the hash only', () => {
  const url = landingUrl('/admin', { code: CODE, cookieName: 'jwtToken' });
  assert.equal(url, `/admin/plugins/magic-sessionmanager/impersonate/land#code=${CODE}&c=jwtToken`);
  assert.deepEqual(parseLandingHash(`#code=${CODE}&c=jwtToken`), {
    code: CODE,
    cookieName: 'jwtToken',
  });
  assert.equal(parseLandingHash('#code=short'), null);
  assert.equal(parseLandingHash(`#code=${CODE}&c=bad;name`), null);
  assert.equal(landingBase('/admin/plugins/magic-sessionmanager/impersonate/land'), '/admin');
  assert.equal(
    landingBase('/cms/admin/plugins/magic-sessionmanager/impersonate/land/'),
    '/cms/admin'
  );
  assert.equal(landingBase('/admin/content-manager'), null);
});

test('cookie helpers read and hide one cookie', () => {
  assert.equal(cookieValue('a=1; jwtToken=abc%2E; b=2', 'jwtToken'), 'abc.');
  assert.equal(withoutCookie('a=1; jwtToken=abc; b=2', 'jwtToken'), 'a=1; b=2');
});

test('without tab state nothing changes', () => {
  const { win } = makeWindow();
  win.localStorage.setItem('jwtToken', JSON.stringify('real'));
  assert.equal(readTabState(win), null);
  assert.equal(win.localStorage.getItem('jwtToken'), JSON.stringify('real'));
});

test('the shim answers with the impersonation token and never touches the shared storage', async () => {
  const { win, requests } = makeWindow();
  win.localStorage.setItem('jwtToken', JSON.stringify('real-admin'));
  win.localStorage.setItem('isLoggedIn', 'true');
  win.document.cookie = 'jwtToken=real-cookie; Path=/';
  assert.equal(readRealToken(win, 'jwtToken'), 'real-admin');
  writeTabState(win, { phase: 'active', token: 'target-token', cookieName: 'jwtToken' });
  let loggedOut = 0;
  assert.equal(installTabShim(win, { onLogout: () => (loggedOut += 1) }), true);
  assert.equal(installTabShim(win), false, 'installs once');

  assert.equal(win.localStorage.getItem('jwtToken'), JSON.stringify('target-token'));
  assert.equal(win.localStorage.getItem('isLoggedIn'), 'true');
  // Strapi's logout reducer and token refresh write these keys: dropped.
  win.localStorage.removeItem('jwtToken');
  win.localStorage.removeItem('isLoggedIn');
  win.localStorage.setItem('jwtToken', JSON.stringify('rotated'));
  // Other keys and sessionStorage are untouched.
  win.localStorage.setItem('STRAPI_THEME', 'dark');
  assert.equal(win.localStorage.getItem('STRAPI_THEME'), 'dark');
  assert.equal(readTabState(win).token, 'target-token');
  assert.ok(win.sessionStorage.getItem(TAB_STATE_KEY));

  // The access cookie is hidden and cannot be written or deleted from here.
  assert.equal(cookieValue(win.document.cookie, 'jwtToken'), null);
  win.document.cookie = 'jwtToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
  win.document.cookie = 'other=1; Path=/';
  assert.match(win.document.cookie, /other=1/);

  const refresh = await win.fetch('http://127.0.0.1:1621/admin/access-token', { method: 'POST' });
  assert.equal(refresh.status, 401);
  const login = await win.fetch('/admin/login', { method: 'POST' });
  assert.equal(login.status, 403);
  const logout = await win.fetch(new URL('http://127.0.0.1:1621/admin/logout'), { method: 'POST' });
  assert.equal(logout.status, 200);
  assert.equal(loggedOut, 1);
  await win.fetch('/admin/users/me');
  assert.deepEqual(requests, ['/admin/users/me'], 'only ordinary requests reach the network');

  // Ending keeps the tab out of the real session: no token at all.
  writeTabState(win, { phase: 'ended', cookieName: 'jwtToken' });
  assert.equal(win.localStorage.getItem('jwtToken'), null);
  assert.equal(win.localStorage.getItem('isLoggedIn'), null);
});

test('the real admin storage survives everything the tab did', () => {
  const { win } = makeWindow();
  win.localStorage.setItem('jwtToken', JSON.stringify('real-admin'));
  writeTabState(win, { phase: 'active', token: 'target-token', cookieName: 'jwtToken' });
  installTabShim(win);
  win.localStorage.removeItem('jwtToken');
  writeTabState(win, null);
  // Another tab (no state) sees the real token, which was never removed.
  assert.equal(win.localStorage.getItem('jwtToken'), JSON.stringify('real-admin'));
});
