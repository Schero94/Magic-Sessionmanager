/**
 * Magic Session Manager - Comprehensive Test Suite
 * Tests User API and Admin API separately
 * 
 * Usage: node test-session-manager.js
 * 
 * Reads credentials from Strapi ENV variables or .env file
 */

// Try to load .env file if available
try {
  require('dotenv').config({ path: '../../../.env' });
} catch (err) {
  // dotenv not installed or .env not found - that's ok, use ENV vars
}

const BASE_URL = process.env.STRAPI_URL || process.env.BASE_URL || 'http://localhost:1337';

// Test Credentials - Must be provided via environment variables
const USER_CREDENTIALS = {
  identifier: process.env.TEST_USER_EMAIL,
  password: process.env.TEST_USER_PASSWORD,
};

const ADMIN_CREDENTIALS = {
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
};

// Validate credentials are provided
if (!USER_CREDENTIALS.identifier || !USER_CREDENTIALS.password) {
  console.error('❌ Missing user credentials. Please set TEST_USER_EMAIL and TEST_USER_PASSWORD environment variables.');
  process.exit(1);
}

if (!ADMIN_CREDENTIALS.email || !ADMIN_CREDENTIALS.password) {
  console.error('❌ Missing admin credentials. Please set ADMIN_EMAIL and ADMIN_PASSWORD environment variables.');
  process.exit(1);
}

// Realistic User-Agent Strings for Testing
const USER_AGENTS = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36',
  ipadSafari: 'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  postman: 'PostmanRuntime/7.49.1',
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

// Test Results
const results = {
  user: { passed: 0, failed: 0, skipped: 0 },
  admin: { passed: 0, failed: 0, skipped: 0 },
  security: { passed: 0, failed: 0, skipped: 0 },
};

// Tokens and IDs
let USER_JWT = null;
let USER_REFRESH_TOKEN = null;
let USER_DOCUMENT_ID = null;  // Strapi v5: documentId (string UUID)
let USER_NUMERIC_ID = null;   // Legacy: numeric id
let ADMIN_JWT = null;
let SESSION_ID = null;

// Helper Functions
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message, category = 'user') {
  log(`✅ ${message}`, colors.green);
  if (category === 'admin' || category === true) results.admin.passed++;
  else if (category === 'security') results.security.passed++;
  else results.user.passed++;
}

function logError(message, category = 'user') {
  log(`❌ ${message}`, colors.red);
  if (category === 'admin' || category === true) results.admin.failed++;
  else if (category === 'security') results.security.failed++;
  else results.user.failed++;
}

function logInfo(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

function logWarning(message, category = 'user') {
  log(`⚠️  ${message}`, colors.yellow);
  if (category === 'admin' || category === true) results.admin.skipped++;
  else if (category === 'security') results.security.skipped++;
  else results.user.skipped++;
}

function logSection(message) {
  log(`\n${'='.repeat(70)}`, colors.magenta);
  log(`  ${message}`, colors.magenta);
  log(`${'='.repeat(70)}`, colors.magenta);
}

function logCategory(message) {
  log(`\n${'▓'.repeat(70)}`, colors.cyan);
  log(`  ${message}`, `${colors.cyan}${colors.bold}`);
  log(`${'▓'.repeat(70)}\n`, colors.cyan);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait with visible countdown (for rate limit avoidance)
 * @param {number} seconds - Seconds to wait
 * @param {string} reason - Why we're waiting
 */
async function waitWithCountdown(seconds, reason = 'rate limit') {
  process.stdout.write(`${colors.yellow}[WAIT] ${reason}: `);
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(`${i}s `);
    await sleep(1000);
  }
  console.log(`${colors.green}GO!${colors.reset}`);
}

/**
 * Login with retry on rate limiting
 * @param {object} credentials - Login credentials
 * @param {string} userAgent - Optional User-Agent header
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<object|null>} Login response data or null
 */
async function loginWithRetry(credentials, userAgent = null, maxRetries = 3) {
  const headers = { 'Content-Type': 'application/json' };
  if (userAgent) {
    headers['User-Agent'] = USER_AGENTS[userAgent] || userAgent;
  }
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${BASE_URL}/api/auth/local`, {
        method: 'POST',
        headers,
        body: JSON.stringify(credentials),
      });
      
      const data = await response.json();
      
      if (response.ok && data.jwt) {
        return data;
      }
      
      // Check if rate limited
      if (response.status === 429 || (data.error?.message || '').includes('Too many')) {
        if (attempt < maxRetries) {
          const waitTime = 30 + (attempt * 15); // 45s, 60s, 75s
          logWarning(`Rate limited, waiting ${waitTime}s before retry ${attempt + 1}/${maxRetries}...`);
          await waitWithCountdown(waitTime, 'Rate limit retry');
          continue;
        }
      }
      
      // Other error - return null
      return { error: data.error, status: response.status };
      
    } catch (err) {
      if (attempt < maxRetries) {
        logWarning(`Login error: ${err.message}, retrying...`);
        await sleep(5000);
        continue;
      }
      return { error: { message: err.message } };
    }
  }
  
  return null;
}

// ============================================================
// USER API TESTS
// ============================================================

/**
 * USER TEST 1: Login & Session Creation
 */
async function userTestLogin(userAgent = null) {
  const testName = userAgent ? 
    `USER TEST 1: Login (${userAgent.split('/')[0]})` : 
    'USER TEST 1: Login & Session Creation';
  
  logSection(testName);
  
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (userAgent) {
      headers['User-Agent'] = USER_AGENTS[userAgent];
    }
    
    const response = await fetch(`${BASE_URL}/api/auth/local`, {
      method: 'POST',
      headers,
      body: JSON.stringify(USER_CREDENTIALS),
    });

    const data = await response.json();

    if (response.ok && data.jwt) {
      USER_JWT = data.jwt;
      USER_REFRESH_TOKEN = data.refreshToken || null;
      // Store both documentId (Strapi v5) and numeric id (legacy)
      USER_DOCUMENT_ID = data.user.documentId || null;
      USER_NUMERIC_ID = data.user.id;
      const device = userAgent ? ` (${userAgent})` : '';
      logSuccess(`Login successful for ${data.user.email}${device}`);
      logInfo(`User ID: ${data.user.id}${USER_DOCUMENT_ID ? ` (documentId: ${USER_DOCUMENT_ID})` : ''}`);
      if (!userAgent) {
        logInfo(`JWT Token: ${USER_JWT.substring(0, 40)}...`);
        if (USER_REFRESH_TOKEN) {
          logInfo(`Refresh Token: ${USER_REFRESH_TOKEN.substring(0, 40)}...`);
        } else {
          logWarning('No refresh token received (JWT management not enabled)');
        }
      }
      return true;
    } else {
      logError(`Login failed: ${data.error?.message || 'Unknown error'}`);
      return false;
    }
  } catch (err) {
    logError(`Login error: ${err.message}`);
    return false;
  }
}

/**
 * USER TEST 1b: Multiple Realistic Logins (Device Diversity Test)
 */
async function userTestMultipleDeviceLogins() {
  logSection('USER TEST 1b: Multiple Device Login Simulation');
  
  const deviceTests = [
    ['chromeWindows', 'Chrome on Windows'],
    ['safariMac', 'Safari on macOS'],
    ['iphoneSafari', 'Safari on iPhone'],
    // Reduced from 7 to 3 devices to avoid rate limiting
  ];
  
  let successCount = 0;
  
  for (const [agentKey, description] of deviceTests) {
    try {
      const response = await fetch(`${BASE_URL}/api/auth/local`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENTS[agentKey],
        },
        body: JSON.stringify(USER_CREDENTIALS),
      });

      if (response.ok) {
        successCount++;
        logInfo(`  [OK] ${description}`);
      } else {
        const errData = await response.json().catch(() => ({}));
        logInfo(`  [FAIL] ${description} (${errData.error?.message || response.status})`);
      }
      
      await sleep(3000); // 3 seconds between device logins to avoid rate limiting
    } catch (err) {
      logInfo(`  ✗ ${description} (${err.message})`);
    }
  }
  
  if (successCount > 0) {
    logSuccess(`Created ${successCount} sessions with different devices`);
    return true;
  } else {
    logError('Failed to create any device-specific sessions');
    return false;
  }
}

/**
 * USER TEST 2: Get Own Sessions
 * Uses /api/magic-sessionmanager/my-sessions (auto-detects user from JWT)
 */
async function userTestGetOwnSessions() {
  logSection('USER TEST 2: Get Own Sessions');
  
  try {
    // Use /my-sessions route - automatically uses authenticated user's documentId
    const response = await fetch(`${BASE_URL}/api/magic-sessionmanager/my-sessions`, {
      headers: { 'Authorization': `Bearer ${USER_JWT}` },
    });

    const data = await response.json();

    if (response.ok) {
      const active = data.data.filter(s => s.isTrulyActive).length;
      logSuccess(`Retrieved ${data.data.length} own sessions`);
      logInfo(`Active: ${active}, Total: ${data.data.length}`);
      
      if (data.data.length > 0) {
        SESSION_ID = data.data[0].documentId || data.data[0].id;
        logInfo(`Session documentId for testing: ${SESSION_ID}`);
      }
      
      return true;
    } else {
      logError(`Get own sessions failed: ${response.status}`);
      return false;
    }
  } catch (err) {
    logError(`Get own sessions error: ${err.message}`);
    return false;
  }
}

/**
 * USER TEST 3: Custom Logout
 */
async function userTestLogout() {
  logSection('USER TEST 3: Logout via /api/magic-sessionmanager/logout');
  
  try {
    const response = await fetch(`${BASE_URL}/api/magic-sessionmanager/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${USER_JWT}` },
    });

    const data = await response.json();

    if (response.ok) {
      logSuccess('Custom logout successful');
      logInfo(`Message: ${data.message}`);
      return true;
    } else {
      logError(`Custom logout failed: ${response.status} - ${JSON.stringify(data)}`);
      return false;
    }
  } catch (err) {
    logError(`Custom logout error: ${err.message}`);
    return false;
  }
}

/**
 * USER TEST 4: Refresh Token (if enabled)
 */
async function userTestRefreshToken() {
  logSection('USER TEST 4: Refresh Token (JWT Refresh)');
  
  // Need fresh login first to get valid tokens
  logInfo('Step 1: Fresh login to get valid refresh token');
  const loginSuccess = await userTestLogin();
  if (!loginSuccess) {
    logError('Cannot test refresh token without login');
    return false;
  }
  await sleep(500);
  
  if (!USER_REFRESH_TOKEN) {
    logWarning('Refresh tokens NOT enabled - Skipping test', false);
    logInfo('To enable: Set jwtManagement: "refresh" in users-permissions config');
    logInfo('Without refresh tokens: Users must re-login when JWT expires');
    return null;
  }
  
  logInfo('Step 2: Use refresh token to get new access token');
  
  try {
    const response = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: USER_REFRESH_TOKEN
      }),
    });

    const data = await response.json();

    if (response.ok && data.jwt) {
      const oldJWT = USER_JWT;
      USER_JWT = data.jwt;
      USER_REFRESH_TOKEN = data.refreshToken || USER_REFRESH_TOKEN;
      
      logSuccess('Refresh token successful - received new access token');
      logInfo(`Old JWT: ${oldJWT.substring(0, 30)}...`);
      logInfo(`New JWT: ${USER_JWT.substring(0, 30)}...`);
      
      if (data.refreshToken) {
        logInfo('New refresh token also received (token rotation)');
      }
      
      return true;
    } else if (response.status === 404) {
      logWarning('Refresh token endpoint not found (404)', false);
      logInfo('Strapi may not have refresh tokens enabled or endpoint not configured');
      return null;
    } else {
      logError(`Refresh token failed: ${response.status} - ${data.error?.message || 'Unknown'}`);
      return false;
    }
  } catch (err) {
    logError(`Refresh token error: ${err.message}`);
    return false;
  }
}

/**
 * USER TEST 5: Blocked Refresh Token (After Session Termination)
 */
async function userTestBlockedRefreshToken() {
  logSection('USER TEST 5: Blocked Refresh Token Test');
  
  if (!USER_REFRESH_TOKEN) {
    logWarning('No refresh token available - skipping blocked refresh test', false);
    return null;
  }
  
  logInfo('Step 1: Login to create fresh session');
  logInfo('⏱️  Waiting 5 seconds to avoid rate limiting...');
  await sleep(5000); // Wait 5 seconds before critical login
  
  const loginSuccess = await userTestLogin();
  if (!loginSuccess) {
    logError('Cannot test blocked refresh without login');
    logWarning('Try running test again after waiting 2 minutes', false);
    return false;
  }
  await sleep(1000);
  
  logInfo('Step 2: Get session ID');
  const sessionsRes = await fetch(`${BASE_URL}/api/magic-sessionmanager/my-sessions`, {
    headers: { 'Authorization': `Bearer ${USER_JWT}` },
  });
  const sessionsData = await sessionsRes.json();
  
  if (!sessionsData.data || sessionsData.data.length === 0) {
    logError('No sessions found after login');
    return false;
  }
  
  // Use documentId (Strapi v5) instead of numeric id
  const sessionToTerminate = sessionsData.data[0].documentId || sessionsData.data[0].id;
  logInfo(`Session ID to terminate: ${sessionToTerminate}`);
  await sleep(500);
  
  logInfo('Step 3: Admin terminates the session');
  const terminateRes = await fetch(`${BASE_URL}/magic-sessionmanager/sessions/${sessionToTerminate}/terminate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
  });
  
  if (!terminateRes.ok) {
    logError('Failed to terminate session');
    return false;
  }
  
  logInfo('Session terminated by admin ✅');
  await sleep(500);
  
  logInfo('Step 4: Try to use refresh token (should be BLOCKED)');
  const refreshRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refreshToken: USER_REFRESH_TOKEN
    }),
  });

  const refreshData = await refreshRes.json();

  if (refreshRes.status === 401) {
    logSuccess('✅ Refresh token BLOCKED as expected!');
    logSuccess('Session termination prevents token refresh (security works!)');
    logInfo(`Message: ${refreshData.error?.message || 'Session terminated'}`);
    return true;
  } else if (refreshRes.ok) {
    logError('❌ Refresh token ALLOWED (should be blocked!)');
    logError('Security gap: User can bypass session termination!');
    return false;
  } else {
    logWarning(`Unexpected status: ${refreshRes.status}`, false);
    return null;
  }
}

/**
 * USER TEST 6: Standard Strapi Logout (/api/auth/logout)
 */
async function userTestStandardLogout() {
  logSection('USER TEST 6: Standard Logout via /api/auth/logout');
  
  // Need fresh login
  const loginResult = await userTestLogin();
  if (!loginResult) {
    logError('Cannot test logout without successful login');
    return false;
  }
  await sleep(500);
  
  try {
    const response = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${USER_JWT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok || response.status === 200) {
      logSuccess('Standard /api/auth/logout successful');
      logInfo(`Response: ${data.message || 'OK'}`);
      return true;
    } else if (response.status === 404) {
      logWarning('Standard logout endpoint returns 404 (expected if not in JWT refresh mode)');
      return null;
    } else if (response.status === 401) {
      logWarning('Standard logout returns 401 (may not be in JWT refresh mode)');
      return null;
    } else {
      logError(`Standard logout failed: ${response.status} - ${JSON.stringify(data)}`);
      return false;
    }
  } catch (err) {
    logError(`Standard logout error: ${err.message}`);
    return false;
  }
}

// ============================================================
// ADMIN API TESTS
// ============================================================

/**
 * ADMIN TEST 1: Admin Login
 */
async function adminTestLogin() {
  logSection('ADMIN TEST 1: Admin Panel Login');
  
  try {
    const response = await fetch(`${BASE_URL}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ADMIN_CREDENTIALS),
    });

    const data = await response.json();

    if (response.ok && data.data?.token) {
      ADMIN_JWT = data.data.token;
      logSuccess(`Admin login successful for ${data.data.user.email}`, true);
      logInfo(`Admin JWT: ${ADMIN_JWT.substring(0, 40)}...`);
      return true;
    } else {
      logError(`Admin login failed: ${data.error?.message || 'Unknown error'}`, true);
      return false;
    }
  } catch (err) {
    logError(`Admin login error: ${err.message}`, true);
    return false;
  }
}

/**
 * ADMIN TEST 2: Get All Sessions
 */
async function adminTestGetAllSessions() {
  logSection('ADMIN TEST 2: Get All Sessions');
  
  try {
    const response = await fetch(`${BASE_URL}/magic-sessionmanager/sessions`, {
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });

    const data = await response.json();

    if (response.ok) {
      logSuccess(`Retrieved ${data.data.length} sessions`, true);
      logInfo(`Active: ${data.meta.active}, Inactive: ${data.meta.inactive}`);
      
      if (data.data.length > 0 && !SESSION_ID) {
        // Use documentId (Strapi v5) instead of numeric id
        SESSION_ID = data.data[0].documentId || data.data[0].id;
        logInfo(`Session documentId for testing: ${SESSION_ID}`);
      }
      
      return true;
    } else {
      logError(`Get all sessions failed: ${response.status}`, true);
      return false;
    }
  } catch (err) {
    logError(`Get all sessions error: ${err.message}`, true);
    return false;
  }
}

/**
 * ADMIN TEST 3: IP Geolocation (Premium)
 */
async function adminTestGeolocation() {
  logSection('ADMIN TEST 3: IP Geolocation (Premium Feature)');
  
  try {
    const testIP = '8.8.8.8'; // Google DNS
    const response = await fetch(`${BASE_URL}/magic-sessionmanager/geolocation/${testIP}`, {
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });

    const data = await response.json();

    if (response.ok && data.data) {
      logSuccess(`Geolocation retrieved for ${testIP}`, true);
      logInfo(`Location: ${data.data.city}, ${data.data.country} ${data.data.country_flag || ''}`);
      logInfo(`Security: Score ${data.data.securityScore}/100 (${data.data.riskLevel})`);
      logInfo(`VPN: ${data.data.isVpn}, Proxy: ${data.data.isProxy}, Threat: ${data.data.isThreat}`);
      return true;
    } else if (response.status === 403) {
      logWarning('Geolocation requires Premium license (403)', true);
      return null;
    } else {
      logError(`Geolocation failed: ${response.status}`, true);
      return false;
    }
  } catch (err) {
    logError(`Geolocation error: ${err.message}`, true);
    return false;
  }
}

/**
 * ADMIN TEST 4: License Status
 */
async function adminTestLicenseStatus() {
  logSection('ADMIN TEST 4: License Status');
  
  try {
    const response = await fetch(`${BASE_URL}/magic-sessionmanager/license/status`, {
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });

    const data = await response.json();

    if (response.ok) {
      logSuccess('License status retrieved', true);
      logInfo(`Valid: ${data.valid}, Demo: ${data.demo}`);
      
      if (data.data) {
        logInfo(`License Key: ${data.data.licenseKey || 'None'}`);
        logInfo(`Email: ${data.data.email || 'N/A'}`);
        logInfo(`Premium: ${data.data.features?.premium}, Advanced: ${data.data.features?.advanced}`);
      }
      
      return true;
    } else {
      logError(`License status failed: ${response.status}`, true);
      return false;
    }
  } catch (err) {
    logError(`License status error: ${err.message}`, true);
    return false;
  }
}

/**
 * ADMIN TEST 5: Terminate Session
 */
async function adminTestTerminateSession() {
  logSection('ADMIN TEST 5: Terminate Session');
  
  if (!SESSION_ID) {
    logWarning('No session ID available, skipping', true);
    return null;
  }
  
  try {
    const response = await fetch(`${BASE_URL}/magic-sessionmanager/sessions/${SESSION_ID}/terminate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });

    const data = await response.json();

    if (response.ok) {
      logSuccess(`Session ${SESSION_ID} terminated`, true);
      return true;
    } else {
      logError(`Terminate session failed: ${response.status}`, true);
      return false;
    }
  } catch (err) {
    logError(`Terminate session error: ${err.message}`, true);
    return false;
  }
}

/**
 * ADMIN TEST 6: Delete Session (Permanent)
 */
async function adminTestDeleteSession() {
  logSection('ADMIN TEST 6: Delete Session (Permanent)');
  
  // Get an inactive session
  try {
    const sessionsRes = await fetch(`${BASE_URL}/magic-sessionmanager/sessions`, {
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });
    
    const sessionsData = await sessionsRes.json();
    
    if (!sessionsData.data || sessionsData.data.length === 0) {
      logWarning('No sessions available to delete', true);
      return null;
    }
    
    const inactiveSession = sessionsData.data.find(s => !s.isActive);
    
    if (!inactiveSession) {
      logWarning('No inactive session found to delete', true);
      return null;
    }
    
    // Use documentId (Strapi v5) instead of numeric id
    const sessionDocId = inactiveSession.documentId || inactiveSession.id;
    
    const response = await fetch(`${BASE_URL}/magic-sessionmanager/sessions/${sessionDocId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });

    const data = await response.json();

    if (response.ok) {
      logSuccess(`Session ${sessionDocId} permanently deleted`, true);
      return true;
    } else {
      logError(`Delete session failed: ${response.status}`, true);
      return false;
    }
  } catch (err) {
    logError(`Delete session error: ${err.message}`, true);
    return false;
  }
}

/**
 * ADMIN TEST 7: Clean All Inactive
 */
async function adminTestCleanInactive() {
  logSection('ADMIN TEST 7: Clean All Inactive Sessions');
  
  try {
    const response = await fetch(`${BASE_URL}/magic-sessionmanager/sessions/clean-inactive`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });

    const data = await response.json();

    if (response.ok) {
      logSuccess(`Cleaned ${data.deletedCount} inactive sessions`, true);
      return true;
    } else {
      logError(`Clean inactive failed: ${response.status}`, true);
      return false;
    }
  } catch (err) {
    logError(`Clean inactive error: ${err.message}`, true);
    return false;
  }
}

/**
 * ADMIN TEST 8: Toggle User Block
 * Uses documentId if available (Strapi v5), falls back to numeric id
 */
async function adminTestToggleUserBlock() {
  logSection('ADMIN TEST 8: Toggle User Block Status');
  
  try {
    // Prefer documentId (Strapi v5), fallback to numeric id
    const userId = USER_DOCUMENT_ID || USER_NUMERIC_ID || 5;
    logInfo(`Testing with user: ${userId}`);
    
    const response = await fetch(`${BASE_URL}/magic-sessionmanager/user/${userId}/toggle-block`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });

    const data = await response.json();

    if (response.ok) {
      logSuccess(`User ${userId} block status toggled`, true);
      logInfo(`New status: ${data.blocked ? 'Blocked' : 'Unblocked'}`);
      
      // Toggle back
      await sleep(500);
      await fetch(`${BASE_URL}/magic-sessionmanager/user/${userId}/toggle-block`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
      });
      logInfo('Toggled back to original state');
      
      return true;
    } else {
      logError(`Toggle block failed: ${response.status} - ${JSON.stringify(data)}`, true);
      return false;
    }
  } catch (err) {
    logError(`Toggle block error: ${err.message}`, true);
    return false;
  }
}

/**
 * ADMIN TEST 9: Validate Analytics Data
 */
async function adminTestAnalyticsData() {
  logSection('ADMIN TEST 9: Validate Analytics Data Quality');
  
  try {
    const response = await fetch(`${BASE_URL}/magic-sessionmanager/sessions`, {
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });

    const data = await response.json();

    if (response.ok && data.data.length > 0) {
      const sessions = data.data;
      
      // Count devices
      const devices = {};
      const browsers = {};
      const os = {};
      
      sessions.forEach(s => {
        const ua = s.userAgent.toLowerCase();
        
        // Devices
        if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')) {
          devices.mobile = (devices.mobile || 0) + 1;
        } else if (ua.includes('ipad') || ua.includes('tablet')) {
          devices.tablet = (devices.tablet || 0) + 1;
        } else {
          devices.desktop = (devices.desktop || 0) + 1;
        }
        
        // Browsers
        if (ua.includes('chrome')) browsers.chrome = (browsers.chrome || 0) + 1;
        else if (ua.includes('firefox')) browsers.firefox = (browsers.firefox || 0) + 1;
        else if (ua.includes('safari')) browsers.safari = (browsers.safari || 0) + 1;
        else if (ua.includes('edg')) browsers.edge = (browsers.edge || 0) + 1;
        
        // OS
        if (ua.includes('windows')) os.windows = (os.windows || 0) + 1;
        else if (ua.includes('mac') || ua.includes('darwin')) os.mac = (os.mac || 0) + 1;
        else if (ua.includes('linux')) os.linux = (os.linux || 0) + 1;
        else if (ua.includes('android')) os.android = (os.android || 0) + 1;
        else if (ua.includes('ios')) os.ios = (os.ios || 0) + 1;
      });
      
      logSuccess(`Analytics data validated from ${sessions.length} sessions`, true);
      logInfo(`Devices: Desktop=${devices.desktop || 0}, Mobile=${devices.mobile || 0}, Tablet=${devices.tablet || 0}`);
      logInfo(`Browsers: Chrome=${browsers.chrome || 0}, Firefox=${browsers.firefox || 0}, Safari=${browsers.safari || 0}, Edge=${browsers.edge || 0}`);
      logInfo(`OS: Windows=${os.windows || 0}, macOS=${os.mac || 0}, iOS=${os.ios || 0}, Android=${os.android || 0}, Linux=${os.linux || 0}`);
      
      // Validate diversity
      const deviceTypes = Object.keys(devices).length;
      const browserTypes = Object.keys(browsers).length;
      
      if (deviceTypes >= 2 && browserTypes >= 2) {
        logInfo(`✨ Good device/browser diversity! (${deviceTypes} device types, ${browserTypes} browsers)`);
      } else {
        logWarning(`Limited diversity: ${deviceTypes} device types, ${browserTypes} browsers`, true);
      }
      
      return true;
    } else {
      logError('No sessions available for analytics validation', true);
      return false;
    }
  } catch (err) {
    logError(`Analytics validation error: ${err.message}`, true);
    return false;
  }
}

/**
 * ADMIN TEST 10: Terminate All User Sessions
 * Uses documentId if available (Strapi v5), falls back to numeric id
 */
async function adminTestTerminateAllUserSessions() {
  logSection('ADMIN TEST 10: Terminate All User Sessions');
  
  try {
    // Prefer documentId (Strapi v5), fallback to numeric id
    const userId = USER_DOCUMENT_ID || USER_NUMERIC_ID || 5;
    logInfo(`Terminating all sessions for user: ${userId}`);
    
    const response = await fetch(`${BASE_URL}/magic-sessionmanager/user/${userId}/terminate-all`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });

    const data = await response.json();

    if (response.ok) {
      logSuccess(`All sessions for user ${userId} terminated`, true);
      return true;
    } else {
      logError(`Terminate all failed: ${response.status} - ${JSON.stringify(data)}`, true);
      return false;
    }
  } catch (err) {
    logError(`Terminate all error: ${err.message}`, true);
    return false;
  }
}

// ============================================================
// CRITICAL SECURITY TESTS: JWT INVALIDATION
// ============================================================

/**
 * SECURITY TEST 1: JWT Invalidation after Single Session Terminate
 * This is a CRITICAL security feature - terminated sessions must NOT allow API access!
 */
async function securityTestJwtInvalidationSingleSession() {
  logSection('SECURITY TEST 1: JWT Invalidation (Single Session)');
  
  try {
    // Step 1: Fresh login to get a new JWT
    logInfo('Step 1: Fresh login to get JWT...');
    const loginRes = await fetch(`${BASE_URL}/api/auth/local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(USER_CREDENTIALS),
    });
    
    const loginData = await loginRes.json();
    
    if (!loginRes.ok || !loginData.jwt) {
      logError('Failed to login for JWT invalidation test');
      return false;
    }
    
    const testJwt = loginData.jwt;
    const userDocId = loginData.user.documentId;
    logInfo(`Got JWT: ${testJwt.substring(0, 40)}...`);
    logInfo(`User documentId: ${userDocId}`);
    await sleep(500);
    
    // Step 2: Verify JWT works - access /api/users/me
    logInfo('Step 2: Verify JWT works (accessing /api/users/me)...');
    const beforeRes = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${testJwt}` },
    });
    
    if (!beforeRes.ok) {
      logError('JWT does not work before termination (unexpected!)');
      return false;
    }
    
    const beforeData = await beforeRes.json();
    logInfo(`BEFORE: /api/users/me returned ${beforeRes.status} - email: ${beforeData.email}`);
    await sleep(500);
    
    // Step 3: Get session ID for this login
    logInfo('Step 3: Get session ID...');
    const sessionsRes = await fetch(`${BASE_URL}/api/magic-sessionmanager/my-sessions`, {
      headers: { 'Authorization': `Bearer ${testJwt}` },
    });
    
    const sessionsData = await sessionsRes.json();
    
    if (!sessionsData.data || sessionsData.data.length === 0) {
      logError('No sessions found after login');
      return false;
    }
    
    const sessionId = sessionsData.data[0].documentId;
    logInfo(`Session ID: ${sessionId}`);
    await sleep(500);
    
    // Step 4: Terminate THIS specific session (via Admin API)
    logInfo('Step 4: Admin terminates the session...');
    const terminateRes = await fetch(`${BASE_URL}/magic-sessionmanager/sessions/${sessionId}/terminate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });
    
    if (!terminateRes.ok) {
      logError(`Failed to terminate session: ${terminateRes.status}`);
      return false;
    }
    
    logInfo('Session terminated by admin');
    await sleep(500);
    
    // Step 5: CRITICAL - Try to use the SAME JWT again
    logInfo('Step 5: [CRITICAL] Try to access /api/users/me with terminated session JWT...');
    const afterRes = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${testJwt}` },
    });
    
    const afterData = await afterRes.json();
    
    // 401 Unauthorized OR 403 Forbidden are both valid "blocked" responses
    if (afterRes.status === 401 || afterRes.status === 403) {
      logSuccess(`[SECURITY OK] JWT correctly BLOCKED after session termination! (${afterRes.status})`, 'security');
      logInfo(`Response: ${afterRes.status} - ${afterData.error?.message || 'Session terminated'}`);
      return true;
    } else if (afterRes.ok) {
      logError('[SECURITY VULNERABILITY] JWT still works after session termination!', 'security');
      logError(`Response: ${afterRes.status} - email: ${afterData.email}`, 'security');
      logError('This is a CRITICAL security issue - sessions can be bypassed!', 'security');
      return false;
    } else {
      logWarning(`Unexpected status: ${afterRes.status}`, 'security');
      return null;
    }
    
  } catch (err) {
    logError(`JWT invalidation test error: ${err.message}`, 'security');
    return false;
  }
}

/**
 * SECURITY TEST 2: JWT Invalidation after Terminate All Sessions
 * Tests that "terminate all" properly invalidates ALL JWTs for a user
 */
async function securityTestJwtInvalidationTerminateAll() {
  logSection('SECURITY TEST 2: JWT Invalidation (Terminate All)');
  
  try {
    // Step 1: Create multiple sessions (simulate multiple devices)
    logInfo('Step 1: Creating multiple sessions (3 devices)...');
    
    const jwts = [];
    const userAgents = ['chromeWindows', 'safariMac', 'iphoneSafari'];
    
    for (const ua of userAgents) {
      const res = await fetch(`${BASE_URL}/api/auth/local`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENTS[ua],
        },
        body: JSON.stringify(USER_CREDENTIALS),
      });
      
      const data = await res.json();
      if (res.ok && data.jwt) {
        jwts.push({ jwt: data.jwt, device: ua });
        logInfo(`  - Session created: ${ua}`);
      } else {
        logWarning(`  - ${ua}: Login failed (${data.error?.message || res.status})`, 'security');
      }
      await sleep(5000); // 5 seconds between logins to avoid rate limiting
    }
    
    if (jwts.length < 2) {
      logError('Could not create enough sessions for test');
      return false;
    }
    
    logInfo(`Created ${jwts.length} sessions`);
    await sleep(500);
    
    // Step 2: Verify ALL JWTs work
    logInfo('Step 2: Verify all JWTs work...');
    for (const { jwt, device } of jwts) {
      const res = await fetch(`${BASE_URL}/api/users/me`, {
        headers: { 'Authorization': `Bearer ${jwt}` },
      });
      if (res.ok) {
        logInfo(`  - ${device}: JWT works`);
      } else {
        logError(`  - ${device}: JWT failed (unexpected)`);
      }
    }
    await sleep(500);
    
    // Step 3: Terminate ALL sessions
    logInfo('Step 3: Admin terminates ALL sessions for user...');
    const userId = USER_DOCUMENT_ID || USER_NUMERIC_ID;
    
    const terminateRes = await fetch(`${BASE_URL}/magic-sessionmanager/user/${userId}/terminate-all`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });
    
    if (!terminateRes.ok) {
      logError('Failed to terminate all sessions');
      return false;
    }
    
    logInfo('All sessions terminated');
    await sleep(500);
    
    // Step 4: CRITICAL - Verify ALL JWTs are now BLOCKED
    logInfo('Step 4: [CRITICAL] Verify ALL JWTs are blocked...');
    let blockedCount = 0;
    let worksCount = 0;
    
    for (const { jwt, device } of jwts) {
      const res = await fetch(`${BASE_URL}/api/users/me`, {
        headers: { 'Authorization': `Bearer ${jwt}` },
      });
      
      // 401 or 403 both mean blocked
      if (res.status === 401 || res.status === 403) {
        blockedCount++;
        logInfo(`  - ${device}: BLOCKED (${res.status}) - correct`);
      } else if (res.ok) {
        worksCount++;
        logError(`  - ${device}: STILL WORKS (security issue!)`);
      }
    }
    
    if (blockedCount === jwts.length) {
      logSuccess(`[SECURITY OK] All ${blockedCount} JWTs correctly blocked!`, 'security');
      return true;
    } else if (worksCount > 0) {
      logError(`[SECURITY VULNERABILITY] ${worksCount}/${jwts.length} JWTs still work after terminate-all!`, 'security');
      return false;
    } else {
      logWarning('Unexpected test results', 'security');
      return null;
    }
    
  } catch (err) {
    logError(`Terminate-all JWT test error: ${err.message}`, 'security');
    return false;
  }
}

/**
 * SECURITY TEST 3: JWT Invalidation on Plugin Endpoints
 * Tests that plugin endpoints also reject terminated session JWTs
 */
async function securityTestJwtInvalidationPluginEndpoints() {
  logSection('SECURITY TEST 3: JWT Invalidation (Plugin Endpoints)');
  
  try {
    // Step 1: Fresh login with retry
    logInfo('Step 1: Fresh login...');
    const loginData = await loginWithRetry(USER_CREDENTIALS);
    
    if (!loginData || !loginData.jwt) {
      logError(`Login failed: ${loginData?.error?.message || 'Unknown error'}`);
      return false;
    }
    
    const testJwt = loginData.jwt;
    await sleep(500);
    
    // Step 2: Verify plugin endpoint works
    logInfo('Step 2: Verify /api/magic-sessionmanager/my-sessions works...');
    const beforeRes = await fetch(`${BASE_URL}/api/magic-sessionmanager/my-sessions`, {
      headers: { 'Authorization': `Bearer ${testJwt}` },
    });
    
    if (!beforeRes.ok) {
      logError('Plugin endpoint does not work before termination');
      return false;
    }
    
    logInfo(`BEFORE: Plugin endpoint returned ${beforeRes.status}`);
    await sleep(500);
    
    // Step 3: Terminate all sessions
    logInfo('Step 3: Terminate all sessions...');
    const userId = USER_DOCUMENT_ID || USER_NUMERIC_ID;
    await fetch(`${BASE_URL}/magic-sessionmanager/user/${userId}/terminate-all`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });
    await sleep(500);
    
    // Step 4: CRITICAL - Try plugin endpoint with terminated JWT
    logInfo('Step 4: [CRITICAL] Try plugin endpoint with terminated JWT...');
    const afterRes = await fetch(`${BASE_URL}/api/magic-sessionmanager/my-sessions`, {
      headers: { 'Authorization': `Bearer ${testJwt}` },
    });
    
    // 401 or 403 both mean blocked
    if (afterRes.status === 401 || afterRes.status === 403) {
      logSuccess(`[SECURITY OK] Plugin endpoint correctly blocked terminated JWT! (${afterRes.status})`, 'security');
      return true;
    } else if (afterRes.ok) {
      logError('[SECURITY VULNERABILITY] Plugin endpoint still accepts terminated JWT!', 'security');
      return false;
    } else {
      logWarning(`Unexpected status: ${afterRes.status}`, 'security');
      return null;
    }
    
  } catch (err) {
    logError(`Plugin endpoint JWT test error: ${err.message}`, 'security');
    return false;
  }
}

/**
 * SECURITY TEST 4: Session Reactivation After Timeout (terminatedManually: false)
 * Tests that sessions deactivated by timeout can be reactivated automatically
 */
async function securityTestSessionReactivationAfterTimeout() {
  logSection('SECURITY TEST 4: Session Reactivation After Timeout');
  
  try {
    // Step 1: Fresh login with retry
    logInfo('Step 1: Fresh login to create session...');
    const loginData = await loginWithRetry(USER_CREDENTIALS);
    
    if (!loginData || !loginData.jwt) {
      logError(`Login failed: ${loginData?.error?.message || 'Unknown error'}`);
      return false;
    }
    
    const testJwt = loginData.jwt;
    logInfo(`Got JWT: ${testJwt.substring(0, 40)}...`);
    await sleep(500);
    
    // Step 2: Get session ID
    logInfo('Step 2: Get session ID...');
    const sessionsRes = await fetch(`${BASE_URL}/api/magic-sessionmanager/my-sessions`, {
      headers: { 'Authorization': `Bearer ${testJwt}` },
    });
    
    const sessionsData = await sessionsRes.json();
    if (!sessionsData.data || sessionsData.data.length === 0) {
      logError('No sessions found after login');
      return false;
    }
    
    const sessionId = sessionsData.data[0].documentId;
    logInfo(`Session ID: ${sessionId}`);
    await sleep(500);
    
    // Step 3: Simulate timeout by directly setting isActive: false, terminatedManually: false
    // We need to use admin API to update the session
    logInfo('Step 3: Simulate session timeout (isActive: false, terminatedManually: false)...');
    
    // Use admin to get session and update it
    const updateRes = await fetch(`${BASE_URL}/magic-sessionmanager/sessions/${sessionId}/simulate-timeout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ADMIN_JWT}` },
    });
    
    // If endpoint doesn't exist, we'll test via normal terminate and check behavior
    if (updateRes.status === 404) {
      logWarning('simulate-timeout endpoint not available, testing via terminate behavior', 'security');
      
      // Alternative: Just verify that after manual terminate, user IS blocked
      // This is tested in other security tests
      return null;
    }
    
    if (!updateRes.ok) {
      logWarning(`Could not simulate timeout: ${updateRes.status}`, 'security');
      return null;
    }
    
    logInfo('Session marked as timed out (terminatedManually: false)');
    await sleep(500);
    
    // Step 4: CRITICAL - Try to use JWT - should be REACTIVATED, not blocked!
    logInfo('Step 4: [CRITICAL] Try to access API with timed-out session JWT...');
    const afterRes = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${testJwt}` },
    });
    
    if (afterRes.ok) {
      logSuccess('[REACTIVATION OK] Session was automatically reactivated after timeout!', 'security');
      logInfo('User can continue working without re-login after inactivity timeout');
      return true;
    } else if (afterRes.status === 401 || afterRes.status === 403) {
      logError('[REACTIVATION FAILED] Session was blocked instead of reactivated!', 'security');
      logError('Users will be logged out after timeout even with valid JWT', 'security');
      return false;
    } else {
      logWarning(`Unexpected status: ${afterRes.status}`, 'security');
      return null;
    }
    
  } catch (err) {
    logError(`Session reactivation test error: ${err.message}`, 'security');
    return false;
  }
}

/**
 * SECURITY TEST 5: Manual Logout Blocks Access (terminatedManually: true)
 * Tests that explicitly logged out sessions are blocked and NOT reactivated
 */
async function securityTestManualLogoutBlocksAccess() {
  logSection('SECURITY TEST 5: Manual Logout Blocks Access');
  
  try {
    // Step 1: Fresh login with retry
    logInfo('Step 1: Fresh login...');
    const loginData = await loginWithRetry(USER_CREDENTIALS);
    
    if (!loginData || !loginData.jwt) {
      logError(`Login failed: ${loginData?.error?.message || 'Unknown error'}`);
      return false;
    }
    
    const testJwt = loginData.jwt;
    logInfo(`Got JWT: ${testJwt.substring(0, 40)}...`);
    await sleep(500);
    
    // Step 2: Verify JWT works
    logInfo('Step 2: Verify JWT works...');
    const beforeRes = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${testJwt}` },
    });
    
    if (!beforeRes.ok) {
      logError('JWT does not work before logout');
      return false;
    }
    logInfo('JWT works before logout');
    await sleep(500);
    
    // Step 3: Perform MANUAL logout via custom endpoint
    logInfo('Step 3: Perform manual logout via /api/magic-sessionmanager/logout...');
    const logoutRes = await fetch(`${BASE_URL}/api/magic-sessionmanager/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${testJwt}` },
    });
    
    if (!logoutRes.ok) {
      logWarning(`Logout endpoint returned ${logoutRes.status}`, 'security');
      // Try standard logout
      await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${testJwt}` },
      });
    } else {
      logInfo('Manual logout successful (terminatedManually: true set)');
    }
    await sleep(500);
    
    // Step 4: CRITICAL - JWT should be BLOCKED (not reactivated!)
    logInfo('Step 4: [CRITICAL] Try to access API after manual logout...');
    const afterRes = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${testJwt}` },
    });
    
    if (afterRes.status === 401 || afterRes.status === 403) {
      logSuccess('[SECURITY OK] Manual logout correctly blocks access!', 'security');
      logInfo('Session with terminatedManually: true cannot be reactivated');
      return true;
    } else if (afterRes.ok) {
      logError('[SECURITY VULNERABILITY] JWT still works after manual logout!', 'security');
      logError('Manual logout should set terminatedManually: true and block permanently', 'security');
      return false;
    } else {
      logWarning(`Unexpected status: ${afterRes.status}`, 'security');
      return null;
    }
    
  } catch (err) {
    logError(`Manual logout test error: ${err.message}`, 'security');
    return false;
  }
}

/**
 * SECURITY TEST 6: JWT Works After Fresh Login (Positive Test)
 * Ensures new logins create valid sessions that work
 */
async function securityTestJwtWorksAfterFreshLogin() {
  logSection('SECURITY TEST 6: JWT Works After Fresh Login (Positive)');
  
  try {
    // Step 1: Fresh login with retry after all sessions were terminated
    logInfo('Step 1: Fresh login (should create new valid session)...');
    const loginData = await loginWithRetry(USER_CREDENTIALS);
    
    if (!loginData || !loginData.jwt) {
      logError(`Login failed: ${loginData?.error?.message || 'Unknown error'}`);
      return false;
    }
    
    const freshJwt = loginData.jwt;
    logInfo(`Got fresh JWT: ${freshJwt.substring(0, 40)}...`);
    
    // Update global tokens for subsequent tests
    USER_JWT = freshJwt;
    USER_DOCUMENT_ID = loginData.user.documentId;
    await sleep(500);
    
    // Step 2: Verify fresh JWT works on /api/users/me
    logInfo('Step 2: Verify fresh JWT works on /api/users/me...');
    const usersRes = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${freshJwt}` },
    });
    
    if (!usersRes.ok) {
      logError(`Fresh JWT does not work on /api/users/me: ${usersRes.status}`);
      return false;
    }
    
    const userData = await usersRes.json();
    logInfo(`/api/users/me works: ${userData.email}`);
    
    // Step 3: Verify fresh JWT works on plugin endpoint
    logInfo('Step 3: Verify fresh JWT works on plugin endpoint...');
    const pluginRes = await fetch(`${BASE_URL}/api/magic-sessionmanager/my-sessions`, {
      headers: { 'Authorization': `Bearer ${freshJwt}` },
    });
    
    if (!pluginRes.ok) {
      logError(`Fresh JWT does not work on plugin endpoint: ${pluginRes.status}`);
      return false;
    }
    
    const pluginData = await pluginRes.json();
    logInfo(`Plugin endpoint works: ${pluginData.data.length} sessions`);
    
    logSuccess('[POSITIVE TEST OK] Fresh login creates valid working session!', 'security');
    return true;
    
  } catch (err) {
    logError(`Fresh login test error: ${err.message}`, 'security');
    return false;
  }
}

/**
 * SUMMARY: Print Test Results
 */
function printSummary() {
  logSection('TEST SUMMARY');
  
  console.log('');
  log('USER API TESTS:', `${colors.cyan}${colors.bold}`);
  log(`  Total:    ${results.user.passed + results.user.failed + results.user.skipped}`, colors.cyan);
  log(`  ✅ Passed:  ${results.user.passed}`, colors.green);
  log(`  ❌ Failed:  ${results.user.failed}`, colors.red);
  log(`  ⚠️  Skipped: ${results.user.skipped}`, colors.yellow);
  
  console.log('');
  log('ADMIN API TESTS:', `${colors.cyan}${colors.bold}`);
  log(`  Total:    ${results.admin.passed + results.admin.failed + results.admin.skipped}`, colors.cyan);
  log(`  ✅ Passed:  ${results.admin.passed}`, colors.green);
  log(`  ❌ Failed:  ${results.admin.failed}`, colors.red);
  log(`  ⚠️  Skipped: ${results.admin.skipped}`, colors.yellow);
  
  console.log('');
  log('🔒 SECURITY TESTS (CRITICAL):', `${colors.magenta}${colors.bold}`);
  log(`  Total:    ${results.security.passed + results.security.failed + results.security.skipped}`, colors.magenta);
  log(`  ✅ Passed:  ${results.security.passed}`, colors.green);
  log(`  ❌ Failed:  ${results.security.failed}`, results.security.failed > 0 ? colors.red : colors.green);
  log(`  ⚠️  Skipped: ${results.security.skipped}`, colors.yellow);
  
  if (results.security.failed > 0) {
    console.log('');
    log('⛔ CRITICAL: Security tests FAILED! JWT invalidation not working!', colors.red);
    log('   Users can still access API after session termination.', colors.red);
  }
  
  const totalPassed = results.user.passed + results.admin.passed + results.security.passed;
  const totalFailed = results.user.failed + results.admin.failed + results.security.failed;
  const totalSkipped = results.user.skipped + results.admin.skipped + results.security.skipped;
  const total = totalPassed + totalFailed + totalSkipped;
  const passRate = total > 0 ? Math.round((totalPassed / total) * 100) : 0;
  
  console.log('');
  log('OVERALL:', `${colors.magenta}${colors.bold}`);
  log(`  Total Tests: ${total}`, colors.magenta);
  log(`  Pass Rate:   ${passRate}%`, passRate >= 80 ? colors.green : colors.yellow);
  console.log('');
  
  if (totalFailed === 0) {
    log('🎉 ALL TESTS PASSED!', colors.green);
  } else if (results.security.failed > 0) {
    log(`⛔ CRITICAL SECURITY FAILURE - ${results.security.failed} security test(s) failed!`, colors.red);
  } else {
    log(`⚠️  ${totalFailed} test(s) failed`, colors.red);
  }
  
  console.log('\n' + '='.repeat(70) + '\n');
}

/**
 * MAIN: Run All Tests
 */
async function runAllTests() {
  log('\n' + '█'.repeat(70), colors.magenta);
  log('  MAGIC SESSION MANAGER - COMPREHENSIVE TEST SUITE', `${colors.magenta}${colors.bold}`);
  log('█'.repeat(70) + '\n', colors.magenta);
  
  logInfo(`Base URL: ${BASE_URL}`);
  logInfo(`User Email: ${USER_CREDENTIALS.identifier}`);
  logInfo(`Admin Email: ${ADMIN_CREDENTIALS.email}`);
  console.log('');
  
  // ============================================================
  // USER API TESTS
  // ============================================================
  logCategory('USER API TESTS');
  
  // Test 1: Simple login to get JWT
  await userTestLogin();
  await sleep(2000); // Wait 2 seconds (rate limit)
  
  // Test 1b: Create sessions with various devices for realistic data
  await userTestMultipleDeviceLogins();
  await sleep(3000); // Wait 3 seconds (multiple logins)
  
  // Test 2: Get own sessions (should show multiple devices now)
  await userTestGetOwnSessions();
  await sleep(1000);
  
  // Test 3: Test logout functionality
  await userTestLogout();
  await sleep(2000); // Wait before next login
  
  // Test 4: Refresh token (if enabled)
  await userTestRefreshToken();
  await sleep(2000);
  
  // Test 5: Standard logout
  await userTestStandardLogout();
  await sleep(3000); // Wait before admin tests
  
  // ============================================================
  // ADMIN API TESTS
  // ============================================================
  logCategory('ADMIN API TESTS');
  
  await adminTestLogin();
  await sleep(1000);
  
  await adminTestGetAllSessions();
  await sleep(1000);
  
  await adminTestGeolocation();
  await sleep(1000);
  
  await adminTestLicenseStatus();
  await sleep(1000);
  
  await adminTestTerminateSession();
  await sleep(1000);
  
  await adminTestDeleteSession();
  await sleep(1000);
  
  await adminTestCleanInactive();
  await sleep(1000);
  
  await adminTestToggleUserBlock();
  await sleep(1000);
  
  await adminTestAnalyticsData();
  await sleep(1000);
  
  await adminTestTerminateAllUserSessions();
  await sleep(5000); // Wait 5 seconds before final test (avoid rate limit)
  
  // ============================================================
  // CRITICAL SECURITY TESTS: JWT INVALIDATION
  // ============================================================
  logCategory('CRITICAL SECURITY TESTS: JWT INVALIDATION');
  
  logInfo('These tests verify that terminated sessions cannot access the API');
  logInfo('This is a CRITICAL security feature!\n');
  
  await waitWithCountdown(10, 'Avoiding rate limit before security tests');
  
  // Test 1: Single session termination (1 login)
  await securityTestJwtInvalidationSingleSession();
  await waitWithCountdown(8, 'Rate limit cooldown');
  
  // Test 2: Terminate all sessions (3 logins!)
  await securityTestJwtInvalidationTerminateAll();
  await waitWithCountdown(15, 'Rate limit cooldown after multiple logins');
  
  // Test 3: Plugin endpoints (1 login)
  await securityTestJwtInvalidationPluginEndpoints();
  await waitWithCountdown(8, 'Rate limit cooldown');
  
  // Test 4: Session reactivation after timeout (1 login)
  await securityTestSessionReactivationAfterTimeout();
  await waitWithCountdown(8, 'Rate limit cooldown');
  
  // Test 5: Manual logout blocks access (1 login)
  await securityTestManualLogoutBlocksAccess();
  await waitWithCountdown(8, 'Rate limit cooldown');
  
  // Test 6: Positive test - fresh login works (1 login)
  await securityTestJwtWorksAfterFreshLogin();
  await sleep(2000);
  
  // ============================================================
  // REFRESH TOKEN SECURITY TEST
  // ============================================================
  logCategory('REFRESH TOKEN SECURITY TEST');
  
  logInfo('[WAIT] Waiting to avoid rate limiting...');
  await sleep(3000);
  
  await userTestBlockedRefreshToken();
  await sleep(1000);
  
  // Print Summary
  printSummary();
  
  // Exit with proper code (security failures are critical!)
  const totalFailed = results.user.failed + results.admin.failed + results.security.failed;
  const securityFailed = results.security.failed;
  
  if (securityFailed > 0) {
    process.exit(2); // Critical security failure
  } else if (totalFailed > 0) {
    process.exit(1); // Regular test failure
  } else {
    process.exit(0); // All tests passed
  }
}

// Run tests
runAllTests().catch(err => {
  logError(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
