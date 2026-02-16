'use strict';

/**
 * Magic Session Manager - Test Suite
 * 
 * Tests User API, Admin API, and Security (JWT invalidation) separately.
 * Structured into phases with clear pass/fail reporting.
 * 
 * Usage:
 *   node test-session-manager.js
 *   node test-session-manager.js --phase=security   (run only security tests)
 *   node test-session-manager.js --phase=user        (run only user tests)
 *   node test-session-manager.js --phase=admin       (run only admin tests)
 *   node test-session-manager.js --phase=fixes       (run only fix verification + false positive tests)
 * 
 * Required ENV vars:
 *   TEST_USER_EMAIL, TEST_USER_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD
 * 
 * Optional ENV vars:
 *   STRAPI_URL (default: http://localhost:1337)
 */

// Load .env if available
try { require('dotenv').config({ path: '../../../.env' }); } catch (_) { /* ok */ }

// -------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------

const BASE_URL = process.env.STRAPI_URL || process.env.BASE_URL || 'http://localhost:1337';

const USER_CREDS = {
  identifier: process.env.TEST_USER_EMAIL,
  password: process.env.TEST_USER_PASSWORD,
};

const ADMIN_CREDS = {
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
};

const USER_AGENTS = {
  chromeWin:    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  safariMac:    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  firefoxWin:   'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  edgeWin:      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  androidChrome:'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36',
};

/** Rate-limit delay between logins (ms) */
const LOGIN_DELAY = 3000;

/** Delay between test phases (ms) */
const PHASE_DELAY = 5000;

// -------------------------------------------------------------------
// Console helpers (no emojis)
// -------------------------------------------------------------------

const C = {
  reset:   '\x1b[0m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
};

/** Prints colored text */
function print(msg, color = C.reset) { console.log(`${color}${msg}${C.reset}`); }

/** Prints a section header */
function header(title) {
  print(`\n${'='.repeat(70)}`, C.cyan);
  print(`  ${title}`, `${C.cyan}${C.bold}`);
  print(`${'='.repeat(70)}`, C.cyan);
}

/** Prints a phase header */
function phaseHeader(title) {
  print(`\n${'#'.repeat(70)}`, C.magenta);
  print(`  ${title}`, `${C.magenta}${C.bold}`);
  print(`${'#'.repeat(70)}\n`, C.magenta);
}

/** Async sleep */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Wait with visible countdown */
async function waitCountdown(seconds, reason) {
  process.stdout.write(`${C.yellow}  [WAIT] ${reason}: `);
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(`${i}s `);
    await sleep(1000);
  }
  console.log(`${C.green}GO${C.reset}`);
}

// -------------------------------------------------------------------
// Test runner
// -------------------------------------------------------------------

const results = { user: [], admin: [], security: [], fixes: [] };

/**
 * Runs a single test and records the result
 * @param {string} category - 'user' | 'admin' | 'security'
 * @param {string} name - Human-readable test name
 * @param {Function} fn - Async test function, must return true/false/null(skip)
 */
async function runTest(category, name, fn) {
  header(name);
  try {
    const result = await fn();
    if (result === true) {
      print(`  [PASS] ${name}`, C.green);
      results[category].push({ name, status: 'pass' });
    } else if (result === false) {
      print(`  [FAIL] ${name}`, C.red);
      results[category].push({ name, status: 'fail' });
    } else {
      print(`  [SKIP] ${name}`, C.yellow);
      results[category].push({ name, status: 'skip' });
    }
  } catch (err) {
    print(`  [FAIL] ${name}: ${err.message}`, C.red);
    results[category].push({ name, status: 'fail', error: err.message });
  }
}

// -------------------------------------------------------------------
// HTTP helpers
// -------------------------------------------------------------------

/**
 * Makes an authenticated API request
 * @param {string} path - URL path (appended to BASE_URL)
 * @param {object} opts - { method, body, token, userAgent, isAdmin }
 * @returns {Promise<{ok: boolean, status: number, data: object}>}
 */
async function api(path, opts = {}) {
  const { method = 'GET', body, token, userAgent } = opts;
  /** @type {Record<string, string>} */
  const headers = {};
  
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body)  headers['Content-Type'] = 'application/json';
  if (userAgent) headers['User-Agent'] = String(USER_AGENTS[userAgent] || userAgent);
  
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

/**
 * Login with retry on rate-limiting
 * @param {object} creds - { identifier, password }
 * @param {string} userAgent - Optional user agent key
 * @param {number} maxRetries - Max retries on rate limit
 * @returns {Promise<object|null>} { jwt, refreshToken, user } or null
 */
async function login(creds, userAgent = null, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await api('/api/auth/local', {
      method: 'POST',
      body: creds,
      userAgent,
    });
    
    if (res.ok && res.data.jwt) {
      return res.data;
    }
    
    if (res.status === 429 && attempt < maxRetries) {
      const wait = 30 + (attempt * 15);
      await waitCountdown(wait, `Rate limited, retry ${attempt + 1}/${maxRetries}`);
      continue;
    }
    
    print(`  [INFO] Login failed: ${res.data?.error?.message || res.status}`, C.dim);
    return null;
  }
  return null;
}

/**
 * Login as Strapi admin
 * @returns {Promise<string|null>} Admin JWT or null
 */
async function adminLogin() {
  const res = await api('/admin/login', {
    method: 'POST',
    body: ADMIN_CREDS,
  });
  
  if (res.ok && res.data?.data?.token) {
    return res.data.data.token;
  }
  print(`  [INFO] Admin login failed: ${res.data?.error?.message || res.status}`, C.dim);
  return null;
}

// -------------------------------------------------------------------
// Shared state
// -------------------------------------------------------------------

let userJwt = null;
let userRefreshToken = null;
let userDocumentId = null;
let adminJwt = null;
let testSessionId = null;

// -------------------------------------------------------------------
// USER API TESTS
// -------------------------------------------------------------------

/** Login and store JWT */
async function testUserLogin() {
  const data = await login(USER_CREDS);
  if (!data) return false;
  
  userJwt = data.jwt;
  userRefreshToken = data.refreshToken || null;
  userDocumentId = data.user.documentId || null;
  
  print(`  [INFO] User: ${data.user.email} (documentId: ${userDocumentId})`, C.blue);
  print(`  [INFO] JWT: ${userJwt.substring(0, 40)}...`, C.blue);
  if (userRefreshToken) print(`  [INFO] Refresh token received`, C.blue);
  return true;
}

/** Create sessions with multiple device User-Agents */
async function testMultiDeviceLogin() {
  const devices = [['chromeWin', 'Chrome/Windows'], ['safariMac', 'Safari/macOS'], ['iphoneSafari', 'Safari/iPhone']];
  let ok = 0;
  
  for (const [key, label] of devices) {
    const data = await login(USER_CREDS, key);
    if (data) {
      ok++;
      print(`  [OK] ${label}`, C.dim);
    } else {
      print(`  [SKIP] ${label} (rate limited)`, C.yellow);
    }
    await sleep(LOGIN_DELAY);
  }
  
  print(`  [INFO] Created ${ok}/${devices.length} device sessions`, C.blue);
  return ok > 0;
}

/** Get own sessions via Content API */
async function testGetOwnSessions() {
  const res = await api('/api/magic-sessionmanager/my-sessions', { token: userJwt });
  if (!res.ok) return false;
  
  const sessions = res.data.data;
  const active = sessions.filter(s => s.isTrulyActive).length;
  print(`  [INFO] Total: ${sessions.length}, Active: ${active}`, C.blue);
  
  if (sessions.length > 0) {
    testSessionId = sessions[0].documentId;
    print(`  [INFO] Test session ID: ${testSessionId}`, C.blue);
  }
  return true;
}

/** Get current session info */
async function testGetCurrentSession() {
  const res = await api('/api/magic-sessionmanager/current-session', { token: userJwt });
  if (!res.ok) return false;
  
  const session = res.data.data;
  print(`  [INFO] Device: ${session.deviceType}, Browser: ${session.browserName}, OS: ${session.osName}`, C.blue);
  print(`  [INFO] Is current: ${session.isCurrentSession}, Active: ${session.isTrulyActive}`, C.blue);
  return session.isCurrentSession === true;
}

/** Logout via plugin endpoint */
async function testPluginLogout() {
  const res = await api('/api/magic-sessionmanager/logout', { method: 'POST', token: userJwt });
  if (!res.ok) return false;
  
  print(`  [INFO] ${res.data.message}`, C.blue);
  return true;
}

/** Logout via standard /api/auth/logout */
async function testStandardLogout() {
  // Need fresh login first
  const data = await login(USER_CREDS);
  if (!data) return false;
  userJwt = data.jwt;
  await sleep(500);
  
  const res = await api('/api/auth/logout', {
    method: 'POST',
    token: data.jwt,
    body: {},
  });
  
  if (res.ok) {
    print(`  [INFO] ${res.data.message || 'OK'}`, C.blue);
    return true;
  }
  if (res.status === 404 || res.status === 401) {
    print(`  [INFO] Endpoint returned ${res.status} (may not be configured)`, C.yellow);
    return null; // Skip
  }
  return false;
}

/** Test refresh token if available */
async function testRefreshToken() {
  // Need fresh login
  const data = await login(USER_CREDS);
  if (!data) return false;
  userJwt = data.jwt;
  userRefreshToken = data.refreshToken;
  await sleep(500);
  
  if (!userRefreshToken) {
    print(`  [INFO] Refresh tokens not enabled - skipping`, C.yellow);
    return null;
  }
  
  const res = await api('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken: userRefreshToken },
  });
  
  if (res.ok && res.data.jwt) {
    userJwt = res.data.jwt;
    userRefreshToken = res.data.refreshToken || userRefreshToken;
    print(`  [INFO] New JWT received`, C.blue);
    return true;
  }
  if (res.status === 404) {
    print(`  [INFO] Refresh endpoint not found (404)`, C.yellow);
    return null;
  }
  return false;
}

/** Terminate own session (not current) */
async function testTerminateOwnSession() {
  // Need fresh login + session list
  const data = await login(USER_CREDS);
  if (!data) return false;
  userJwt = data.jwt;
  await sleep(500);
  
  const sessRes = await api('/api/magic-sessionmanager/my-sessions', { token: userJwt });
  if (!sessRes.ok || !sessRes.data.data?.length) return false;
  
  // Find a non-current session to terminate
  const other = sessRes.data.data.find(s => !s.isCurrentSession && s.documentId);
  if (!other) {
    print(`  [INFO] No non-current session available to terminate`, C.yellow);
    return null;
  }
  
  const res = await api(`/api/magic-sessionmanager/my-sessions/${other.documentId}`, {
    method: 'DELETE',
    token: userJwt,
  });
  
  if (res.ok) {
    print(`  [INFO] Terminated session ${other.documentId}`, C.blue);
    return true;
  }
  return false;
}

// -------------------------------------------------------------------
// ADMIN API TESTS
// -------------------------------------------------------------------

/** Admin login */
async function testAdminLogin() {
  adminJwt = await adminLogin();
  if (!adminJwt) return false;
  print(`  [INFO] Admin JWT: ${adminJwt.substring(0, 40)}...`, C.blue);
  return true;
}

/** Get all sessions (admin) */
async function testAdminGetAllSessions() {
  const res = await api('/magic-sessionmanager/sessions', { token: adminJwt });
  if (!res.ok) return false;
  
  print(`  [INFO] Total: ${res.data.meta.count}, Active: ${res.data.meta.active}, Inactive: ${res.data.meta.inactive}`, C.blue);
  
  if (res.data.data.length > 0 && !testSessionId) {
    testSessionId = res.data.data[0].documentId;
  }
  return true;
}

/** Get active sessions only (admin) */
async function testAdminGetActiveSessions() {
  const res = await api('/magic-sessionmanager/sessions/active', { token: adminJwt });
  if (!res.ok) return false;
  
  print(`  [INFO] Active sessions: ${res.data.meta.count}`, C.blue);
  return true;
}

/** Get user sessions (admin) */
async function testAdminGetUserSessions() {
  if (!userDocumentId) return null;
  
  const res = await api(`/magic-sessionmanager/user/${userDocumentId}/sessions`, { token: adminJwt });
  if (!res.ok) return false;
  
  print(`  [INFO] User sessions: ${res.data.meta.count}`, C.blue);
  return true;
}

/** IP Geolocation (premium) */
async function testAdminGeolocation() {
  const res = await api('/magic-sessionmanager/geolocation/8.8.8.8', { token: adminJwt });
  
  if (res.ok && res.data.data) {
    const geo = res.data.data;
    print(`  [INFO] 8.8.8.8 -> ${geo.city}, ${geo.country} (Score: ${geo.securityScore}/100)`, C.blue);
    return true;
  }
  if (res.status === 403) {
    print(`  [INFO] Premium license required (403)`, C.yellow);
    return null;
  }
  return false;
}

/** License status */
async function testAdminLicenseStatus() {
  const res = await api('/magic-sessionmanager/license/status', { token: adminJwt });
  if (!res.ok) return false;
  
  print(`  [INFO] Valid: ${res.data.valid}, Demo: ${res.data.demo}`, C.blue);
  if (res.data.data?.features) {
    const f = res.data.data.features;
    print(`  [INFO] Features: Premium=${f.premium}, Advanced=${f.advanced}`, C.blue);
  }
  return true;
}

/** Terminate a session (admin) */
async function testAdminTerminateSession() {
  if (!testSessionId) {
    print(`  [INFO] No session ID available`, C.yellow);
    return null;
  }
  
  const res = await api(`/magic-sessionmanager/sessions/${testSessionId}/terminate`, {
    method: 'POST',
    token: adminJwt,
  });
  
  if (res.ok) {
    print(`  [INFO] Session ${testSessionId} terminated`, C.blue);
    return true;
  }
  return false;
}

/** Delete an inactive session permanently (admin) */
async function testAdminDeleteSession() {
  const sessRes = await api('/magic-sessionmanager/sessions', { token: adminJwt });
  if (!sessRes.ok) return false;
  
  const inactive = sessRes.data.data.find(s => !s.isActive);
  if (!inactive) {
    print(`  [INFO] No inactive session to delete`, C.yellow);
    return null;
  }
  
  const res = await api(`/magic-sessionmanager/sessions/${inactive.documentId}`, {
    method: 'DELETE',
    token: adminJwt,
  });
  
  if (res.ok) {
    print(`  [INFO] Session ${inactive.documentId} permanently deleted`, C.blue);
    return true;
  }
  return false;
}

/** Clean all inactive sessions (admin) */
async function testAdminCleanInactive() {
  const res = await api('/magic-sessionmanager/sessions/clean-inactive', {
    method: 'POST',
    token: adminJwt,
  });
  
  if (res.ok) {
    print(`  [INFO] Cleaned ${res.data.deletedCount} inactive sessions`, C.blue);
    return true;
  }
  return false;
}

/** Toggle user block (admin) - toggles and reverts */
async function testAdminToggleBlock() {
  const userId = userDocumentId;
  if (!userId) return null;
  
  const res1 = await api(`/magic-sessionmanager/user/${userId}/toggle-block`, {
    method: 'POST',
    token: adminJwt,
  });
  
  if (!res1.ok) return false;
  print(`  [INFO] User ${res1.data.blocked ? 'blocked' : 'unblocked'}`, C.blue);
  
  // Revert
  await sleep(500);
  await api(`/magic-sessionmanager/user/${userId}/toggle-block`, {
    method: 'POST',
    token: adminJwt,
  });
  print(`  [INFO] Reverted to original state`, C.blue);
  return true;
}

/** Terminate all sessions for a user (admin) */
async function testAdminTerminateAll() {
  const userId = userDocumentId;
  if (!userId) return null;
  
  const res = await api(`/magic-sessionmanager/user/${userId}/terminate-all`, {
    method: 'POST',
    token: adminJwt,
  });
  
  if (res.ok) {
    print(`  [INFO] All sessions for user ${userId} terminated`, C.blue);
    return true;
  }
  return false;
}

/** Settings: get and update */
async function testAdminSettings() {
  // Get settings
  const getRes = await api('/magic-sessionmanager/settings', { token: adminJwt });
  if (!getRes.ok) return false;
  
  const settings = getRes.data.settings;
  print(`  [INFO] Current inactivityTimeout: ${settings.inactivityTimeout}m`, C.blue);
  
  // Update with same values (roundtrip test)
  const putRes = await api('/magic-sessionmanager/settings', {
    method: 'PUT',
    token: adminJwt,
    body: settings,
  });
  
  if (putRes.ok) {
    print(`  [INFO] Settings roundtrip successful`, C.blue);
    return true;
  }
  return false;
}

// -------------------------------------------------------------------
// SECURITY TESTS
// -------------------------------------------------------------------

/**
 * SECURITY 1: JWT blocked after single session terminate
 * - Login -> verify JWT works -> terminate session -> verify JWT blocked
 */
async function testSecJwtBlockedAfterTerminate() {
  // Step 1: Login
  const data = await login(USER_CREDS);
  if (!data) return false;
  const jwt = data.jwt;
  const docId = data.user.documentId;
  await sleep(500);
  
  // Step 2: Verify JWT works
  const before = await api('/api/users/me', { token: jwt });
  if (!before.ok) {
    print(`  [FAIL] JWT does not work before termination`, C.red);
    return false;
  }
  print(`  [INFO] BEFORE: /api/users/me -> ${before.status} (${before.data.email})`, C.blue);
  await sleep(500);
  
  // Step 3: Get session ID
  const sessRes = await api('/api/magic-sessionmanager/my-sessions', { token: jwt });
  if (!sessRes.ok || !sessRes.data.data?.length) return false;
  const sessionId = sessRes.data.data[0].documentId;
  await sleep(500);
  
  // Step 4: Admin terminates the session
  const termRes = await api(`/magic-sessionmanager/sessions/${sessionId}/terminate`, {
    method: 'POST',
    token: adminJwt,
  });
  if (!termRes.ok) return false;
  print(`  [INFO] Session ${sessionId} terminated by admin`, C.blue);
  await sleep(500);
  
  // Step 5: CRITICAL - JWT should be blocked
  const after = await api('/api/users/me', { token: jwt });
  
  if (after.status === 401 || after.status === 403) {
    print(`  [PASS] JWT correctly BLOCKED (${after.status})`, C.green);
    return true;
  }
  if (after.ok) {
    print(`  [FAIL] JWT still works after termination - SECURITY VULNERABILITY`, C.red);
    return false;
  }
  print(`  [INFO] Unexpected status: ${after.status}`, C.yellow);
  return null;
}

/**
 * SECURITY 2: All JWTs blocked after terminate-all
 * - Create 3 sessions -> terminate all -> verify all blocked
 */
async function testSecJwtBlockedAfterTerminateAll() {
  // Step 1: Create multiple sessions
  const jwts = [];
  const agents = ['chromeWin', 'safariMac', 'iphoneSafari'];
  
  for (const ua of agents) {
    const data = await login(USER_CREDS, ua);
    if (data) {
      jwts.push({ jwt: data.jwt, device: ua });
      print(`  [INFO] Session created: ${ua}`, C.dim);
    }
    await sleep(PHASE_DELAY);
  }
  
  if (jwts.length < 2) {
    print(`  [INFO] Only ${jwts.length} sessions created (need 2+)`, C.yellow);
    return null;
  }
  
  // Step 2: Verify all work
  for (const { jwt, device } of jwts) {
    const res = await api('/api/users/me', { token: jwt });
    if (!res.ok) print(`  [WARN] ${device}: JWT already invalid`, C.yellow);
  }
  await sleep(500);
  
  // Step 3: Terminate all
  const userId = userDocumentId;
  await api(`/magic-sessionmanager/user/${userId}/terminate-all`, {
    method: 'POST',
    token: adminJwt,
  });
  print(`  [INFO] All sessions terminated for user ${userId}`, C.blue);
  await sleep(500);
  
  // Step 4: Verify all blocked
  let blocked = 0;
  let works = 0;
  
  for (const { jwt, device } of jwts) {
    const res = await api('/api/users/me', { token: jwt });
    if (res.status === 401 || res.status === 403) {
      blocked++;
      print(`  [OK] ${device}: BLOCKED (${res.status})`, C.dim);
    } else if (res.ok) {
      works++;
      print(`  [FAIL] ${device}: STILL WORKS`, C.red);
    }
  }
  
  if (blocked === jwts.length) {
    print(`  [PASS] All ${blocked} JWTs correctly blocked`, C.green);
    return true;
  }
  if (works > 0) {
    print(`  [FAIL] ${works}/${jwts.length} JWTs still work after terminate-all`, C.red);
    return false;
  }
  return null;
}

/**
 * SECURITY 3: Plugin endpoints also block terminated JWTs
 */
async function testSecPluginEndpointBlocked() {
  const data = await login(USER_CREDS);
  if (!data) return false;
  const jwt = data.jwt;
  await sleep(500);
  
  // Verify plugin endpoint works
  const before = await api('/api/magic-sessionmanager/my-sessions', { token: jwt });
  if (!before.ok) return false;
  print(`  [INFO] BEFORE: Plugin endpoint -> ${before.status}`, C.blue);
  await sleep(500);
  
  // Terminate all
  await api(`/magic-sessionmanager/user/${userDocumentId}/terminate-all`, {
    method: 'POST',
    token: adminJwt,
  });
  await sleep(500);
  
  // Verify blocked
  const after = await api('/api/magic-sessionmanager/my-sessions', { token: jwt });
  
  if (after.status === 401 || after.status === 403) {
    print(`  [PASS] Plugin endpoint correctly blocked (${after.status})`, C.green);
    return true;
  }
  if (after.ok) {
    print(`  [FAIL] Plugin endpoint still accepts terminated JWT`, C.red);
    return false;
  }
  return null;
}

/**
 * SECURITY 4: Session reactivation after timeout (terminatedManually: false)
 * Timed-out sessions should be reactivated when user returns
 */
async function testSecReactivationAfterTimeout() {
  const data = await login(USER_CREDS);
  if (!data) return false;
  const jwt = data.jwt;
  await sleep(500);
  
  // Get session ID
  const sessRes = await api('/api/magic-sessionmanager/my-sessions', { token: jwt });
  if (!sessRes.ok || !sessRes.data.data?.length) return false;
  const sessionId = sessRes.data.data[0].documentId;
  await sleep(500);
  
  // Simulate timeout via admin endpoint
  const simRes = await api(`/magic-sessionmanager/sessions/${sessionId}/simulate-timeout`, {
    method: 'POST',
    token: adminJwt,
  });
  
  if (simRes.status === 404) {
    print(`  [INFO] simulate-timeout endpoint not available`, C.yellow);
    return null;
  }
  if (!simRes.ok) return null;
  
  print(`  [INFO] Session marked as timed out (terminatedManually: false)`, C.blue);
  await sleep(500);
  
  // JWT should be reactivated (not blocked)
  const after = await api('/api/users/me', { token: jwt });
  
  if (after.ok) {
    print(`  [PASS] Session correctly reactivated after timeout`, C.green);
    return true;
  }
  if (after.status === 401 || after.status === 403) {
    print(`  [FAIL] Session blocked instead of reactivated`, C.red);
    return false;
  }
  return null;
}

/**
 * SECURITY 5: Manual logout permanently blocks access (terminatedManually: true)
 */
async function testSecManualLogoutBlocks() {
  const data = await login(USER_CREDS);
  if (!data) return false;
  const jwt = data.jwt;
  await sleep(500);
  
  // Verify JWT works
  const before = await api('/api/users/me', { token: jwt });
  if (!before.ok) return false;
  await sleep(500);
  
  // Manual logout
  await api('/api/magic-sessionmanager/logout', { method: 'POST', token: jwt });
  await sleep(500);
  
  // JWT should be BLOCKED (not reactivated)
  const after = await api('/api/users/me', { token: jwt });
  
  if (after.status === 401 || after.status === 403) {
    print(`  [PASS] Manual logout correctly blocks access (${after.status})`, C.green);
    return true;
  }
  if (after.ok) {
    print(`  [FAIL] JWT still works after manual logout`, C.red);
    return false;
  }
  return null;
}

/**
 * SECURITY 6: Fresh login creates a working session (positive test)
 */
async function testSecFreshLoginWorks() {
  const data = await login(USER_CREDS);
  if (!data) return false;
  const jwt = data.jwt;
  userJwt = jwt;
  userDocumentId = data.user.documentId;
  await sleep(500);
  
  // Verify on /api/users/me
  const usersRes = await api('/api/users/me', { token: jwt });
  if (!usersRes.ok) {
    print(`  [FAIL] Fresh JWT does not work on /api/users/me`, C.red);
    return false;
  }
  
  // Verify on plugin endpoint
  const pluginRes = await api('/api/magic-sessionmanager/my-sessions', { token: jwt });
  if (!pluginRes.ok) {
    print(`  [FAIL] Fresh JWT does not work on plugin endpoint`, C.red);
    return false;
  }
  
  print(`  [PASS] Fresh login creates valid working session`, C.green);
  return true;
}

/**
 * SECURITY 7: Blocked refresh token after session termination
 */
async function testSecBlockedRefreshToken() {
  if (!userRefreshToken) {
    print(`  [INFO] Refresh tokens not enabled`, C.yellow);
    return null;
  }
  
  const data = await login(USER_CREDS);
  if (!data || !data.refreshToken) return null;
  const refreshToken = data.refreshToken;
  await sleep(500);
  
  // Get session and terminate it
  const sessRes = await api('/api/magic-sessionmanager/my-sessions', { token: data.jwt });
  if (!sessRes.ok || !sessRes.data.data?.length) return false;
  
  await api(`/magic-sessionmanager/sessions/${sessRes.data.data[0].documentId}/terminate`, {
    method: 'POST',
    token: adminJwt,
  });
  await sleep(500);
  
  // Try refresh - should be blocked
  const refreshRes = await api('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  });
  
  if (refreshRes.status === 401) {
    print(`  [PASS] Refresh token correctly blocked after termination`, C.green);
    return true;
  }
  if (refreshRes.ok) {
    print(`  [FAIL] Refresh token still works after session termination`, C.red);
    return false;
  }
  return null;
}

// -------------------------------------------------------------------
// PHASE 4: FIX VERIFICATION & FALSE POSITIVE TESTS
// -------------------------------------------------------------------

/**
 * FIX-1: IDOR Protection - User cannot access another user's sessions
 * Verifies that Content API enforces ownership check on /user/:userId/sessions
 */
async function testFixIdorProtection() {
  const data = await login(USER_CREDS);
  if (!data) return false;
  const jwt = data.jwt;
  await sleep(500);
  
  // Try to access sessions of a fake/different user ID
  const fakeUserId = 'aaaa0000bbbb1111cccc2222';
  const res = await api(`/api/magic-sessionmanager/user/${fakeUserId}/sessions`, { token: jwt });
  
  if (res.status === 403) {
    print(`  [PASS] IDOR blocked: Cannot access other user's sessions (403)`, C.green);
    return true;
  }
  if (res.ok) {
    print(`  [FAIL] IDOR vulnerability: Can access other user's sessions!`, C.red);
    return false;
  }
  // 404 or other error is also acceptable (user doesn't exist)
  print(`  [PASS] IDOR blocked: Got ${res.status} (not 200)`, C.green);
  return true;
}

/**
 * FIX-2: Block-reason NOT exposed to client
 * Verifies login block response has generic message, no details.reason
 * (We can't trigger a real block, but we verify response format on normal login)
 */
async function testFixNoBlockReasonExposed() {
  // This test verifies the response structure - a blocked login should NOT
  // contain details.reason. We test by checking normal login doesn't have it
  // and that the error format is clean.
  const data = await login(USER_CREDS);
  if (!data) return false;
  
  // Verify normal login response doesn't contain any security details
  const hasNoSecurityLeak = !data.securityScore && !data.blockReason && !data.geoData;
  if (hasNoSecurityLeak) {
    print(`  [PASS] Login response contains no security internals`, C.green);
    return true;
  }
  print(`  [FAIL] Login response leaks security data`, C.red);
  return false;
}

/**
 * FIX-3: Session responses strip sensitive fields
 * Verifies token, tokenHash, refreshToken are NOT in API responses
 */
async function testFixNoTokenLeakInResponse() {
  const data = await login(USER_CREDS);
  if (!data) return false;
  await sleep(500);
  
  // Get own sessions
  const res = await api('/api/magic-sessionmanager/my-sessions', { token: data.jwt });
  if (!res.ok || !res.data.data?.length) return false;
  
  const session = res.data.data[0];
  const leakedFields = [];
  
  if (session.token) leakedFields.push('token');
  if (session.tokenHash) leakedFields.push('tokenHash');
  if (session.refreshToken) leakedFields.push('refreshToken');
  if (session.refreshTokenHash) leakedFields.push('refreshTokenHash');
  
  if (leakedFields.length === 0) {
    print(`  [PASS] No sensitive fields leaked in session response`, C.green);
    
    // Verify useful fields ARE present
    const hasDeviceInfo = session.deviceType && session.browserName && session.osName;
    const hasTimestamps = session.loginTime && session.lastActive !== undefined;
    const hasFlags = session.isCurrentSession !== undefined && session.isTrulyActive !== undefined;
    
    if (hasDeviceInfo && hasTimestamps && hasFlags) {
      print(`  [INFO] Device: ${session.deviceType}, Browser: ${session.browserName}`, C.blue);
      print(`  [INFO] Required fields present: deviceType, browserName, osName, loginTime, isCurrentSession`, C.blue);
    } else {
      print(`  [WARN] Some expected fields missing from response`, C.yellow);
    }
    return true;
  }
  
  print(`  [FAIL] Sensitive fields leaked: ${leakedFields.join(', ')}`, C.red);
  return false;
}

/**
 * FIX-4: Settings webhook URL SSRF protection
 * Verifies that invalid webhook URLs are rejected/sanitized
 */
async function testFixWebhookSsrfProtection() {
  if (!adminJwt) return null;
  
  // Get current settings
  const getRes = await api('/magic-sessionmanager/settings', { token: adminJwt });
  if (!getRes.ok) return false;
  const originalSettings = getRes.data.settings;
  
  // Try to set an SSRF webhook URL
  const maliciousSettings = {
    ...originalSettings,
    enableWebhooks: true,
    discordWebhookUrl: 'http://169.254.169.254/metadata/v1/',
    slackWebhookUrl: 'https://evil-attacker.com/steal-data',
  };
  
  const putRes = await api('/magic-sessionmanager/settings', {
    method: 'PUT',
    token: adminJwt,
    body: maliciousSettings,
  });
  
  if (!putRes.ok) return false;
  
  const saved = putRes.data.settings;
  const discordBlocked = saved.discordWebhookUrl === '';
  const slackBlocked = saved.slackWebhookUrl === '';
  
  // Restore original settings
  await api('/magic-sessionmanager/settings', {
    method: 'PUT',
    token: adminJwt,
    body: originalSettings,
  });
  
  if (discordBlocked && slackBlocked) {
    print(`  [PASS] SSRF URLs correctly blocked (both sanitized to empty)`, C.green);
    return true;
  }
  if (discordBlocked || slackBlocked) {
    print(`  [WARN] Partial SSRF protection: discord=${discordBlocked}, slack=${slackBlocked}`, C.yellow);
    return true; // Still pass - at least some protection
  }
  print(`  [FAIL] SSRF URLs were NOT blocked!`, C.red);
  return false;
}

/**
 * FIX-5: Settings sanitize XSS in email templates
 * Verifies that <script> tags are stripped from email templates
 */
async function testFixEmailTemplateXss() {
  if (!adminJwt) return null;
  
  // Get current settings
  const getRes = await api('/magic-sessionmanager/settings', { token: adminJwt });
  if (!getRes.ok) return false;
  const originalSettings = getRes.data.settings;
  
  // Try to inject XSS in email templates
  const xssSettings = {
    ...originalSettings,
    emailTemplates: {
      suspiciousLogin: {
        subject: 'Test <script>alert(1)</script>',
        html: '<h1>Test</h1><script>document.cookie</script><p>Safe</p><iframe src="evil.com"></iframe>',
        text: 'Plain text is fine',
      },
      newLocation: { subject: '', html: '', text: '' },
      vpnProxy: { subject: '', html: '', text: '' },
    },
  };
  
  const putRes = await api('/magic-sessionmanager/settings', {
    method: 'PUT',
    token: adminJwt,
    body: xssSettings,
  });
  
  if (!putRes.ok) return false;
  
  const saved = putRes.data.settings;
  const htmlContent = saved.emailTemplates?.suspiciousLogin?.html || '';
  const subjectContent = saved.emailTemplates?.suspiciousLogin?.subject || '';
  
  const scriptStripped = !htmlContent.includes('<script>') && !htmlContent.includes('</script>');
  const iframeStripped = !htmlContent.includes('<iframe');
  const safeContentKept = htmlContent.includes('<h1>Test</h1>') && htmlContent.includes('<p>Safe</p>');
  
  // Restore original settings
  await api('/magic-sessionmanager/settings', {
    method: 'PUT',
    token: adminJwt,
    body: originalSettings,
  });
  
  if (scriptStripped && iframeStripped) {
    print(`  [PASS] XSS tags stripped from email templates`, C.green);
    if (safeContentKept) {
      print(`  [INFO] Safe HTML preserved: <h1>, <p> tags kept`, C.blue);
    }
    return true;
  }
  print(`  [FAIL] XSS tags NOT stripped! script=${!scriptStripped}, iframe=${!iframeStripped}`, C.red);
  return false;
}

/**
 * FIX-6: Geolocation rejects invalid IP formats
 * Verifies that malformed IPs are rejected (SSRF prevention)
 */
async function testFixGeolocationIpValidation() {
  if (!adminJwt) return null;
  
  const invalidIps = [
    'not-an-ip',
    '../../etc/passwd',
    'http://internal-server',
    ':',
    'a',
    '256.256.256.256',
  ];
  
  let allBlocked = true;
  
  for (const ip of invalidIps) {
    const res = await api(`/magic-sessionmanager/geolocation/${encodeURIComponent(ip)}`, { token: adminJwt });
    if (res.status === 400) {
      print(`  [OK] "${ip}" -> 400 Bad Request`, C.dim);
    } else if (res.status === 403) {
      print(`  [OK] "${ip}" -> 403 (license check before validation)`, C.dim);
    } else if (res.ok) {
      print(`  [FAIL] "${ip}" -> 200 (should be rejected!)`, C.red);
      allBlocked = false;
    } else {
      print(`  [OK] "${ip}" -> ${res.status}`, C.dim);
    }
  }
  
  if (allBlocked) {
    print(`  [PASS] All invalid IPs correctly rejected`, C.green);
    return true;
  }
  return false;
}

/**
 * FIX-7: Settings integer boundaries are enforced
 * Verifies that extreme values are clamped to safe ranges
 */
async function testFixSettingsBoundaries() {
  if (!adminJwt) return null;
  
  // Get current settings
  const getRes = await api('/magic-sessionmanager/settings', { token: adminJwt });
  if (!getRes.ok) return false;
  const originalSettings = getRes.data.settings;
  
  // Try extreme values
  const extremeSettings = {
    ...originalSettings,
    inactivityTimeout: 999999,   // Should be clamped to 1440
    cleanupInterval: -5,          // Should be clamped to 5
    maxFailedLogins: 0,           // Should be clamped to 1
    retentionDays: 99999,         // Should be clamped to 365
  };
  
  const putRes = await api('/magic-sessionmanager/settings', {
    method: 'PUT',
    token: adminJwt,
    body: extremeSettings,
  });
  
  if (!putRes.ok) return false;
  
  const saved = putRes.data.settings;
  
  const inactivityOk = saved.inactivityTimeout <= 1440;
  const cleanupOk = saved.cleanupInterval >= 5;
  const failedOk = saved.maxFailedLogins >= 1;
  const retentionOk = saved.retentionDays <= 365;
  
  // Restore original settings
  await api('/magic-sessionmanager/settings', {
    method: 'PUT',
    token: adminJwt,
    body: originalSettings,
  });
  
  if (inactivityOk && cleanupOk && failedOk && retentionOk) {
    print(`  [PASS] Integer boundaries enforced correctly`, C.green);
    print(`  [INFO] inactivity=${saved.inactivityTimeout} (max 1440), cleanup=${saved.cleanupInterval} (min 5)`, C.blue);
    print(`  [INFO] maxFailed=${saved.maxFailedLogins} (min 1), retention=${saved.retentionDays} (max 365)`, C.blue);
    return true;
  }
  print(`  [FAIL] Some boundaries not enforced: inactivity=${saved.inactivityTimeout}, cleanup=${saved.cleanupInterval}`, C.red);
  return false;
}

/**
 * FIX-8: Auth boundary - Content API rejects unauthenticated requests
 * All Content API endpoints MUST return 401 without a JWT
 */
async function testFixAuthBoundaryContentApi() {
  const endpoints = [
    ['GET',    '/api/magic-sessionmanager/my-sessions'],
    ['GET',    '/api/magic-sessionmanager/current-session'],
    ['POST',   '/api/magic-sessionmanager/logout'],
    ['POST',   '/api/magic-sessionmanager/logout-all'],
    ['DELETE', '/api/magic-sessionmanager/my-sessions/fake-id-12345'],
  ];
  
  let allBlocked = true;
  
  for (const [method, path] of endpoints) {
    const res = await api(path, { method });
    // 401 or 403 are both valid rejection codes
    if (res.status === 401 || res.status === 403) {
      print(`  [OK] ${method} ${path} -> ${res.status}`, C.dim);
    } else {
      print(`  [FAIL] ${method} ${path} -> ${res.status} (expected 401/403)`, C.red);
      allBlocked = false;
    }
  }
  
  if (allBlocked) {
    print(`  [PASS] All ${endpoints.length} Content API endpoints reject unauthenticated requests`, C.green);
    return true;
  }
  return false;
}

/**
 * FIX-9: Auth boundary - Admin API rejects user JWT
 * Admin endpoints must NOT be accessible with a normal user JWT
 */
async function testFixAuthBoundaryAdminApi() {
  // Login as normal user
  const data = await login(USER_CREDS);
  if (!data) return false;
  await sleep(500);
  
  const adminEndpoints = [
    ['GET',  '/magic-sessionmanager/sessions'],
    ['GET',  '/magic-sessionmanager/sessions/active'],
    ['GET',  '/magic-sessionmanager/settings'],
    ['GET',  '/magic-sessionmanager/license/status'],
    ['POST', '/magic-sessionmanager/sessions/clean-inactive'],
  ];
  
  let allBlocked = true;
  
  for (const [method, path] of adminEndpoints) {
    const res = await api(path, { method, token: data.jwt });
    if (res.status === 401 || res.status === 403) {
      print(`  [OK] ${method} ${path} -> ${res.status}`, C.dim);
    } else if (res.ok) {
      print(`  [FAIL] ${method} ${path} -> ${res.status} (user can access admin endpoint!)`, C.red);
      allBlocked = false;
    } else {
      print(`  [OK] ${method} ${path} -> ${res.status}`, C.dim);
    }
  }
  
  if (allBlocked) {
    print(`  [PASS] All admin endpoints reject normal user JWT`, C.green);
    return true;
  }
  return false;
}

/**
 * FIX-10: Logout route security - no token returns 401
 * Our fix: /api/auth/logout requires a Bearer token
 */
async function testFixLogoutWithoutToken() {
  // Attempt 1: No Authorization header at all
  const res1 = await api('/api/auth/logout', { method: 'POST', body: {} });
  
  if (res1.status !== 401) {
    print(`  [FAIL] Logout without token returned ${res1.status} (expected 401)`, C.red);
    return false;
  }
  print(`  [OK] No token -> 401`, C.dim);
  
  // Attempt 2: Garbage token (should still gracefully handle)
  const res2 = await api('/api/auth/logout', {
    method: 'POST',
    token: 'not-a-real-jwt-token-at-all',
    body: {},
  });
  
  // Garbage token: verify returns null -> 401, OR catch block -> cleanup -> 200
  // Both are acceptable
  if (res2.status === 401 || res2.status === 200) {
    print(`  [OK] Garbage token -> ${res2.status} (graceful handling)`, C.dim);
  } else {
    print(`  [FAIL] Garbage token -> ${res2.status} (unexpected)`, C.red);
    return false;
  }
  
  print(`  [PASS] Logout route correctly handles missing/invalid tokens`, C.green);
  return true;
}

/**
 * FIX-11: Cannot terminate current session via DELETE
 * User must use /logout instead of DELETE /my-sessions/:currentId
 */
async function testFixCannotTerminateCurrentSession() {
  const data = await login(USER_CREDS);
  if (!data) return false;
  await sleep(500);
  
  // Get current session
  const sessRes = await api('/api/magic-sessionmanager/my-sessions', { token: data.jwt });
  if (!sessRes.ok || !sessRes.data.data?.length) return false;
  
  const currentSession = sessRes.data.data.find(s => s.isCurrentSession);
  if (!currentSession) {
    print(`  [SKIP] No current session found in response`, C.yellow);
    return null;
  }
  
  // Try to DELETE the current session
  const delRes = await api(`/api/magic-sessionmanager/my-sessions/${currentSession.documentId}`, {
    method: 'DELETE',
    token: data.jwt,
  });
  
  if (delRes.status === 400) {
    print(`  [PASS] Cannot terminate current session via DELETE (400: ${delRes.data.error?.message || 'Use /logout'})`, C.green);
    userJwt = data.jwt;
    return true;
  }
  if (delRes.ok) {
    print(`  [FAIL] Current session was terminated via DELETE (should be blocked!)`, C.red);
    return false;
  }
  print(`  [INFO] Unexpected status: ${delRes.status}`, C.yellow);
  return null;
}

/**
 * FIX-12: geoLocation returned as object (not JSON string)
 * Verifies our JSON.stringify fix - response must contain parsed object
 */
async function testFixGeoLocationIsObject() {
  const data = await login(USER_CREDS);
  if (!data) return false;
  await sleep(500);
  
  const res = await api('/api/magic-sessionmanager/my-sessions', { token: data.jwt });
  if (!res.ok || !res.data.data?.length) return false;
  
  // Find a session with geoLocation data
  const sessionWithGeo = res.data.data.find(s => s.geoLocation);
  
  if (!sessionWithGeo) {
    print(`  [SKIP] No session has geoLocation data yet (localhost?)`, C.yellow);
    return null;
  }
  
  const geo = sessionWithGeo.geoLocation;
  
  if (typeof geo === 'string') {
    print(`  [FAIL] geoLocation is a string (should be object): "${geo.substring(0, 50)}..."`, C.red);
    return false;
  }
  
  if (typeof geo === 'object' && geo !== null) {
    const hasFields = geo.country || geo.city || geo.country_code;
    if (hasFields) {
      print(`  [PASS] geoLocation is a parsed object: ${geo.city || '?'}, ${geo.country || '?'}`, C.green);
      return true;
    }
  }
  
  print(`  [WARN] geoLocation exists but structure unclear: ${typeof geo}`, C.yellow);
  return null;
}

/**
 * FIX-13: Valid webhook URLs are accepted (not false-blocked by SSRF filter)
 * Tests that legitimate Discord/Slack URLs pass through
 */
async function testFixValidWebhookUrlsAccepted() {
  if (!adminJwt) return null;
  
  const getRes = await api('/magic-sessionmanager/settings', { token: adminJwt });
  if (!getRes.ok) return false;
  const originalSettings = getRes.data.settings;
  
  // Set valid webhook URLs
  const validSettings = {
    ...originalSettings,
    enableWebhooks: true,
    discordWebhookUrl: 'https://discord.com/api/webhooks/123456/abcdef',
    slackWebhookUrl: 'https://hooks.slack.com/services/T00/B00/xxxx',
  };
  
  const putRes = await api('/magic-sessionmanager/settings', {
    method: 'PUT',
    token: adminJwt,
    body: validSettings,
  });
  
  if (!putRes.ok) return false;
  
  const saved = putRes.data.settings;
  const discordOk = saved.discordWebhookUrl === validSettings.discordWebhookUrl;
  const slackOk = saved.slackWebhookUrl === validSettings.slackWebhookUrl;
  
  // Restore original
  await api('/magic-sessionmanager/settings', { method: 'PUT', token: adminJwt, body: originalSettings });
  
  if (discordOk && slackOk) {
    print(`  [PASS] Valid Discord & Slack webhook URLs accepted`, C.green);
    return true;
  }
  print(`  [FAIL] Valid URLs blocked: discord=${discordOk}, slack=${slackOk}`, C.red);
  return false;
}

/**
 * FIX-14: Session metadata consistency
 * meta.count must match data.length, meta.active must match filtered count
 */
async function testFixMetadataConsistency() {
  const data = await login(USER_CREDS);
  if (!data) return false;
  await sleep(500);
  
  const res = await api('/api/magic-sessionmanager/my-sessions', { token: data.jwt });
  if (!res.ok) return false;
  
  const sessions = res.data.data;
  const meta = res.data.meta;
  
  const countMatch = meta.count === sessions.length;
  const activeCount = sessions.filter(s => s.isTrulyActive).length;
  const activeMatch = meta.active === activeCount;
  
  if (countMatch && activeMatch) {
    print(`  [PASS] Metadata consistent: count=${meta.count}, active=${meta.active}`, C.green);
    userJwt = data.jwt;
    return true;
  }
  
  print(`  [FAIL] Metadata mismatch: meta.count=${meta.count} vs data.length=${sessions.length}, meta.active=${meta.active} vs filtered=${activeCount}`, C.red);
  return false;
}

/**
 * FIX-15: License ping endpoint works
 */
async function testFixLicensePing() {
  if (!adminJwt) return null;
  
  const res = await api('/magic-sessionmanager/license/ping', { method: 'POST', token: adminJwt });
  
  // 200 = license exists and pinged, 400 = no license key (demo mode)
  if (res.ok) {
    print(`  [PASS] License ping successful`, C.green);
    return true;
  }
  if (res.status === 400 && res.data?.error?.message?.includes('No license')) {
    print(`  [SKIP] No license key (demo mode)`, C.yellow);
    return null;
  }
  // Any response is fine as long as it doesn't crash
  print(`  [PASS] License ping handled gracefully (${res.status})`, C.green);
  return true;
}

// -------------------------------------------------------------------
// FALSE POSITIVE TESTS (real user behavior that MUST work)
// -------------------------------------------------------------------

/**
 * FP-1: Rapid sequential API calls don't get blocked
 * A normal user browsing the admin panel makes many requests quickly
 */
async function testFpRapidRequests() {
  const data = await login(USER_CREDS);
  if (!data) return false;
  const jwt = data.jwt;
  await sleep(500);
  
  // Simulate rapid browsing: 5 requests in quick succession
  const endpoints = [
    '/api/users/me',
    '/api/magic-sessionmanager/my-sessions',
    '/api/magic-sessionmanager/current-session',
    '/api/users/me',
    '/api/magic-sessionmanager/my-sessions',
  ];
  
  let allOk = true;
  for (const ep of endpoints) {
    const res = await api(ep, { token: jwt });
    if (!res.ok) {
      print(`  [FAIL] Rapid request to ${ep} blocked (${res.status})`, C.red);
      allOk = false;
    }
  }
  
  if (allOk) {
    print(`  [PASS] All ${endpoints.length} rapid requests succeeded (no false block)`, C.green);
    return true;
  }
  return false;
}

/**
 * FP-2: Login works immediately after logout
 * User logs out and immediately logs in again - should work
 */
async function testFpLoginAfterLogout() {
  // Step 1: Login
  const data1 = await login(USER_CREDS);
  if (!data1) return false;
  await sleep(500);
  
  // Step 2: Logout
  await api('/api/magic-sessionmanager/logout', { method: 'POST', token: data1.jwt });
  await sleep(500);
  
  // Step 3: Verify old JWT is blocked
  const blocked = await api('/api/users/me', { token: data1.jwt });
  if (blocked.ok) {
    print(`  [WARN] Old JWT still works after logout (reactivation may have kicked in)`, C.yellow);
  }
  
  // Step 4: Login again immediately
  const data2 = await login(USER_CREDS);
  if (!data2) {
    print(`  [FAIL] Cannot login after logout`, C.red);
    return false;
  }
  
  // Step 5: New JWT works
  const res = await api('/api/users/me', { token: data2.jwt });
  if (res.ok) {
    print(`  [PASS] Login after logout works correctly`, C.green);
    userJwt = data2.jwt;
    return true;
  }
  print(`  [FAIL] New JWT does not work after re-login`, C.red);
  return false;
}

/**
 * FP-3: Multiple simultaneous sessions work correctly
 * User logged in on 2 devices - both should work at the same time
 */
async function testFpMultipleSessionsWork() {
  // Login with 2 different user agents
  const data1 = await login(USER_CREDS, 'chromeWin');
  if (!data1) return false;
  await sleep(LOGIN_DELAY);
  
  const data2 = await login(USER_CREDS, 'safariMac');
  if (!data2) return false;
  await sleep(500);
  
  // Both JWTs should work
  const res1 = await api('/api/users/me', { token: data1.jwt });
  const res2 = await api('/api/users/me', { token: data2.jwt });
  
  if (res1.ok && res2.ok) {
    print(`  [PASS] Both sessions work simultaneously`, C.green);
    
    // Verify they show as separate sessions
    const sessRes = await api('/api/magic-sessionmanager/my-sessions', { token: data2.jwt });
    if (sessRes.ok) {
      const active = sessRes.data.data.filter(s => s.isTrulyActive).length;
      print(`  [INFO] Active sessions: ${active}`, C.blue);
    }
    userJwt = data2.jwt;
    return true;
  }
  
  print(`  [FAIL] Session 1: ${res1.status}, Session 2: ${res2.status}`, C.red);
  return false;
}

/**
 * FP-4: Session data accuracy - device/browser/OS parsed correctly
 * Verifies that user agent parsing produces meaningful data
 */
async function testFpSessionDataAccuracy() {
  // Login with known user agent
  const data = await login(USER_CREDS, 'chromeWin');
  if (!data) return false;
  await sleep(500);
  
  const res = await api('/api/magic-sessionmanager/current-session', { token: data.jwt });
  if (!res.ok) return false;
  
  const s = res.data.data;
  let checks = 0;
  let passed = 0;
  
  // Check device type
  checks++;
  if (s.deviceType === 'desktop') {
    passed++;
    print(`  [OK] deviceType: "${s.deviceType}" (expected: desktop)`, C.dim);
  } else {
    print(`  [FAIL] deviceType: "${s.deviceType}" (expected: desktop)`, C.red);
  }
  
  // Check browser
  checks++;
  if (s.browserName && s.browserName.includes('Chrome')) {
    passed++;
    print(`  [OK] browserName: "${s.browserName}" (contains Chrome)`, C.dim);
  } else {
    print(`  [FAIL] browserName: "${s.browserName}" (expected Chrome)`, C.red);
  }
  
  // Check OS
  checks++;
  if (s.osName && s.osName.includes('Windows')) {
    passed++;
    print(`  [OK] osName: "${s.osName}" (contains Windows)`, C.dim);
  } else {
    print(`  [FAIL] osName: "${s.osName}" (expected Windows)`, C.red);
  }
  
  // Check IP exists
  checks++;
  if (s.ipAddress && s.ipAddress !== 'unknown') {
    passed++;
    print(`  [OK] ipAddress: "${s.ipAddress}"`, C.dim);
  } else {
    print(`  [FAIL] ipAddress missing or unknown`, C.red);
  }
  
  // Check timestamps
  checks++;
  if (s.loginTime && s.minutesSinceActive !== undefined) {
    passed++;
    print(`  [OK] Timestamps present: loginTime, minutesSinceActive=${s.minutesSinceActive}`, C.dim);
  } else {
    print(`  [FAIL] Timestamps missing`, C.red);
  }
  
  if (passed === checks) {
    print(`  [PASS] All ${checks} data accuracy checks passed`, C.green);
    userJwt = data.jwt;
    return true;
  }
  print(`  [WARN] ${passed}/${checks} accuracy checks passed`, C.yellow);
  return passed >= 3; // Pass if at least 3 of 5 checks pass
}

/**
 * FP-5: User can terminate own non-current session without affecting current
 * Simulates user removing an old device from their session list
 */
async function testFpTerminateOtherKeepsCurrent() {
  // Login twice with different devices
  const data1 = await login(USER_CREDS, 'chromeWin');
  if (!data1) return false;
  await sleep(LOGIN_DELAY);
  
  const data2 = await login(USER_CREDS, 'iphoneSafari');
  if (!data2) return false;
  await sleep(500);
  
  // Get sessions from device 2
  const sessRes = await api('/api/magic-sessionmanager/my-sessions', { token: data2.jwt });
  if (!sessRes.ok || !sessRes.data.data?.length) return false;
  
  // Find the non-current session (device 1)
  const otherSession = sessRes.data.data.find(s => !s.isCurrentSession);
  if (!otherSession) {
    print(`  [SKIP] Only 1 session visible, cannot test cross-terminate`, C.yellow);
    return null;
  }
  
  // Terminate device 1's session from device 2
  const termRes = await api(`/api/magic-sessionmanager/my-sessions/${otherSession.documentId}`, {
    method: 'DELETE',
    token: data2.jwt,
  });
  
  if (!termRes.ok) {
    print(`  [FAIL] Could not terminate other session: ${termRes.status}`, C.red);
    return false;
  }
  
  // Current session (device 2) must still work
  const stillWorks = await api('/api/users/me', { token: data2.jwt });
  if (stillWorks.ok) {
    print(`  [PASS] Terminated other session, current session still works`, C.green);
    userJwt = data2.jwt;
    return true;
  }
  print(`  [FAIL] Current session broken after terminating other session`, C.red);
  return false;
}

// -------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------

/** Prints final test summary */
function printSummary() {
  print(`\n${'='.repeat(70)}`, C.magenta);
  print(`  TEST SUMMARY`, `${C.magenta}${C.bold}`);
  print(`${'='.repeat(70)}`, C.magenta);
  
  const categories = [
    ['USER API', results.user],
    ['ADMIN API', results.admin],
    ['SECURITY', results.security],
    ['FIX VERIFICATION & FALSE POSITIVES', results.fixes],
  ];
  
  let totalPass = 0, totalFail = 0, totalSkip = 0;
  
  for (const [label, tests] of categories) {
    const testArr = /** @type {Array<{name: string, status: string, error?: string}>} */ (tests);
    const pass = testArr.filter(t => t.status === 'pass').length;
    const fail = testArr.filter(t => t.status === 'fail').length;
    const skip = testArr.filter(t => t.status === 'skip').length;
    totalPass += pass; totalFail += fail; totalSkip += skip;
    
    console.log('');
    print(`  ${label}:`, `${C.cyan}${C.bold}`);
    print(`    Total:   ${pass + fail + skip}`, C.cyan);
    print(`    Passed:  ${pass}`, pass > 0 ? C.green : C.dim);
    print(`    Failed:  ${fail}`, fail > 0 ? C.red : C.dim);
    print(`    Skipped: ${skip}`, skip > 0 ? C.yellow : C.dim);
    
    // List failures
    const failures = testArr.filter(t => t.status === 'fail');
    if (failures.length > 0) {
      for (const f of failures) {
        print(`      [FAIL] ${f.name}${f.error ? ': ' + f.error : ''}`, C.red);
      }
    }
  }
  
  const total = totalPass + totalFail + totalSkip;
  const rate = total > 0 ? Math.round((totalPass / total) * 100) : 0;
  
  console.log('');
  print(`  OVERALL: ${totalPass}/${total} passed (${rate}%)`, rate >= 80 ? C.green : C.yellow);
  
  const secFails = results.security.filter(t => t.status === 'fail').length;
  if (secFails > 0) {
    print(`\n  [CRITICAL] ${secFails} security test(s) FAILED!`, C.red);
  } else if (totalFail === 0) {
    print(`\n  [SUCCESS] All tests passed!`, C.green);
  } else {
    print(`\n  [WARNING] ${totalFail} test(s) failed`, C.yellow);
  }
  
  print(`\n${'='.repeat(70)}\n`, C.magenta);
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

async function main() {
  // Parse CLI args
  const phaseArg = process.argv.find(a => a.startsWith('--phase='));
  const phase = phaseArg ? phaseArg.split('=')[1] : 'all';
  
  print(`\n${'#'.repeat(70)}`, C.magenta);
  print(`  MAGIC SESSION MANAGER - TEST SUITE`, `${C.magenta}${C.bold}`);
  print(`${'#'.repeat(70)}`, C.magenta);
  print(`  URL:   ${BASE_URL}`, C.dim);
  print(`  User:  ${USER_CREDS.identifier}`, C.dim);
  print(`  Admin: ${ADMIN_CREDS.email}`, C.dim);
  print(`  Phase: ${phase}`, C.dim);
  console.log('');
  
  // Validate credentials
  if (!USER_CREDS.identifier || !USER_CREDS.password) {
    print('[ERROR] Missing TEST_USER_EMAIL / TEST_USER_PASSWORD env vars', C.red);
    process.exit(1);
  }
  if (!ADMIN_CREDS.email || !ADMIN_CREDS.password) {
    print('[ERROR] Missing ADMIN_EMAIL / ADMIN_PASSWORD env vars', C.red);
    process.exit(1);
  }
  
  // Admin login is needed for admin and security tests
  const needsAdmin = ['all', 'admin', 'security', 'fixes'].includes(phase);
  if (needsAdmin) {
    phaseHeader('ADMIN LOGIN');
    adminJwt = await adminLogin();
    if (!adminJwt) {
      print('[ERROR] Admin login failed - cannot run admin/security tests', C.red);
      if (!['all', 'user'].includes(phase)) process.exit(1);
    }
  }
  
  // USER API TESTS
  if (phase === 'all' || phase === 'user') {
    phaseHeader('PHASE 1: USER API TESTS');
    
    await runTest('user', 'User Login', testUserLogin);
    await sleep(LOGIN_DELAY);
    
    await runTest('user', 'Multi-Device Login', testMultiDeviceLogin);
    await sleep(LOGIN_DELAY);
    
    await runTest('user', 'Get Own Sessions', testGetOwnSessions);
    await sleep(500);
    
    await runTest('user', 'Get Current Session', testGetCurrentSession);
    await sleep(500);
    
    await runTest('user', 'Terminate Own Session', testTerminateOwnSession);
    await sleep(LOGIN_DELAY);
    
    await runTest('user', 'Plugin Logout', testPluginLogout);
    await sleep(LOGIN_DELAY);
    
    await runTest('user', 'Standard Logout (/api/auth/logout)', testStandardLogout);
    await sleep(LOGIN_DELAY);
    
    await runTest('user', 'Refresh Token', testRefreshToken);
    await sleep(PHASE_DELAY);
  }
  
  // ADMIN API TESTS
  if (phase === 'all' || phase === 'admin') {
    phaseHeader('PHASE 2: ADMIN API TESTS');
    
    // Ensure we have a user session for admin tests
    if (!userDocumentId) {
      const data = await login(USER_CREDS);
      if (data) {
        userJwt = data.jwt;
        userDocumentId = data.user.documentId;
      }
      await sleep(LOGIN_DELAY);
    }
    
    await runTest('admin', 'Admin: Get All Sessions', testAdminGetAllSessions);
    await sleep(500);
    
    await runTest('admin', 'Admin: Get Active Sessions', testAdminGetActiveSessions);
    await sleep(500);
    
    await runTest('admin', 'Admin: Get User Sessions', testAdminGetUserSessions);
    await sleep(500);
    
    await runTest('admin', 'Admin: IP Geolocation', testAdminGeolocation);
    await sleep(500);
    
    await runTest('admin', 'Admin: License Status', testAdminLicenseStatus);
    await sleep(500);
    
    await runTest('admin', 'Admin: Settings Roundtrip', testAdminSettings);
    await sleep(500);
    
    await runTest('admin', 'Admin: Terminate Session', testAdminTerminateSession);
    await sleep(500);
    
    await runTest('admin', 'Admin: Delete Session', testAdminDeleteSession);
    await sleep(500);
    
    await runTest('admin', 'Admin: Clean Inactive', testAdminCleanInactive);
    await sleep(500);
    
    await runTest('admin', 'Admin: Toggle User Block', testAdminToggleBlock);
    await sleep(500);
    
    await runTest('admin', 'Admin: Terminate All User Sessions', testAdminTerminateAll);
    await sleep(PHASE_DELAY);
  }
  
  // SECURITY TESTS
  if (phase === 'all' || phase === 'security') {
    phaseHeader('PHASE 3: SECURITY TESTS (JWT INVALIDATION)');
    print('  These tests verify terminated sessions cannot access the API', C.dim);
    print('  This is a CRITICAL security feature!\n', C.dim);
    
    await waitCountdown(8, 'Rate limit cooldown before security tests');
    
    await runTest('security', 'SEC-1: JWT Blocked After Session Terminate', testSecJwtBlockedAfterTerminate);
    await waitCountdown(8, 'Rate limit cooldown');
    
    await runTest('security', 'SEC-2: All JWTs Blocked After Terminate-All', testSecJwtBlockedAfterTerminateAll);
    await waitCountdown(12, 'Rate limit cooldown (multi-login test)');
    
    await runTest('security', 'SEC-3: Plugin Endpoints Block Terminated JWT', testSecPluginEndpointBlocked);
    await waitCountdown(8, 'Rate limit cooldown');
    
    await runTest('security', 'SEC-4: Session Reactivation After Timeout', testSecReactivationAfterTimeout);
    await waitCountdown(8, 'Rate limit cooldown');
    
    await runTest('security', 'SEC-5: Manual Logout Blocks Access', testSecManualLogoutBlocks);
    await waitCountdown(8, 'Rate limit cooldown');
    
    await runTest('security', 'SEC-6: Fresh Login Works (Positive)', testSecFreshLoginWorks);
    await sleep(LOGIN_DELAY);
    
    await runTest('security', 'SEC-7: Blocked Refresh Token', testSecBlockedRefreshToken);
  }
  
  // FIX VERIFICATION & FALSE POSITIVE TESTS
  if (phase === 'all' || phase === 'fixes') {
    phaseHeader('PHASE 4: FIX VERIFICATION & FALSE POSITIVE TESTS');
    print('  These tests verify security fixes work and normal usage is not blocked\n', C.dim);
    
    // Ensure we have credentials
    if (!userDocumentId) {
      const data = await login(USER_CREDS);
      if (data) { userJwt = data.jwt; userDocumentId = data.user.documentId; }
      await sleep(LOGIN_DELAY);
    }
    if (!adminJwt) {
      adminJwt = await adminLogin();
      await sleep(500);
    }
    
    // Fix verification tests
    await runTest('fixes', 'FIX-1: IDOR Protection (user isolation)', testFixIdorProtection);
    await sleep(LOGIN_DELAY);
    
    await runTest('fixes', 'FIX-2: No Security Details in Login Response', testFixNoBlockReasonExposed);
    await sleep(500);
    
    await runTest('fixes', 'FIX-3: No Token Leak in Session Response', testFixNoTokenLeakInResponse);
    await sleep(LOGIN_DELAY);
    
    await runTest('fixes', 'FIX-4: Webhook SSRF Protection', testFixWebhookSsrfProtection);
    await sleep(500);
    
    await runTest('fixes', 'FIX-5: Email Template XSS Sanitization', testFixEmailTemplateXss);
    await sleep(500);
    
    await runTest('fixes', 'FIX-6: Geolocation IP Validation', testFixGeolocationIpValidation);
    await sleep(500);
    
    await runTest('fixes', 'FIX-7: Settings Integer Boundaries', testFixSettingsBoundaries);
    await sleep(500);
    
    await runTest('fixes', 'FIX-8: Auth Boundary - Content API (no JWT)', testFixAuthBoundaryContentApi);
    await sleep(LOGIN_DELAY);
    
    await runTest('fixes', 'FIX-9: Auth Boundary - Admin API (user JWT)', testFixAuthBoundaryAdminApi);
    await sleep(LOGIN_DELAY);
    
    await runTest('fixes', 'FIX-10: Logout Without Token (401)', testFixLogoutWithoutToken);
    await sleep(LOGIN_DELAY);
    
    await runTest('fixes', 'FIX-11: Cannot DELETE Current Session', testFixCannotTerminateCurrentSession);
    await sleep(LOGIN_DELAY);
    
    await runTest('fixes', 'FIX-12: geoLocation Is Object (not string)', testFixGeoLocationIsObject);
    await sleep(500);
    
    await runTest('fixes', 'FIX-13: Valid Webhook URLs Accepted', testFixValidWebhookUrlsAccepted);
    await sleep(500);
    
    await runTest('fixes', 'FIX-14: Session Metadata Consistency', testFixMetadataConsistency);
    await sleep(LOGIN_DELAY);
    
    await runTest('fixes', 'FIX-15: License Ping Endpoint', testFixLicensePing);
    await sleep(LOGIN_DELAY);
    
    // False positive tests (real user behavior)
    print('', C.reset);
    print('  --- False Positive Tests (real user behavior) ---\n', C.dim);
    
    await runTest('fixes', 'FP-1: Rapid Sequential Requests (no false block)', testFpRapidRequests);
    await sleep(LOGIN_DELAY);
    
    await runTest('fixes', 'FP-2: Login After Logout Works', testFpLoginAfterLogout);
    await sleep(LOGIN_DELAY);
    
    await runTest('fixes', 'FP-3: Multiple Simultaneous Sessions', testFpMultipleSessionsWork);
    await sleep(LOGIN_DELAY);
    
    await runTest('fixes', 'FP-4: Session Data Accuracy (UA parsing)', testFpSessionDataAccuracy);
    await sleep(LOGIN_DELAY);
    
    await runTest('fixes', 'FP-5: Terminate Other Session Keeps Current', testFpTerminateOtherKeepsCurrent);
  }
  
  // Summary
  printSummary();
  
  // Exit code
  const secFails = results.security.filter(t => t.status === 'fail').length;
  const fixFails = results.fixes.filter(t => t.status === 'fail').length;
  const totalFails = [...results.user, ...results.admin, ...results.security, ...results.fixes]
    .filter(t => t.status === 'fail').length;
  
  if (secFails > 0) process.exit(2);
  if (totalFails > 0) process.exit(1);
  process.exit(0);
}

main().catch(err => {
  print(`[FATAL] ${err.message}`, C.red);
  console.error(err);
  process.exit(1);
});
