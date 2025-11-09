# Magic Session Manager 🔐

**Advanced Session Management for Strapi v5** - Track user login/logout, monitor active sessions, and secure your application with IP geolocation, threat detection, and real-time analytics.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/strapi-plugin-magic-sessionmanager.svg)](https://www.npmjs.com/package/strapi-plugin-magic-sessionmanager)
[![GitHub release](https://img.shields.io/github/v/release/Schero94/Magic-Sessionmanager.svg)](https://github.com/Schero94/Magic-Sessionmanager/releases)

---

## 📋 Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Strapi Integration](#strapi-integration)
- [Admin Dashboard](#admin-dashboard)
- [API Routes](#api-routes)
- [Configuration](#configuration)
- [Premium Features](#premium-features)
- [Use Cases](#use-cases)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## ✨ Features

### Core Session Management
✅ **Automatic Session Tracking** - Sessions created on login, terminated on logout  
✅ **Session History** - Complete record of all login/logout events with IP & browser  
✅ **Activity Monitoring** - Track last seen time with rate limiting  
✅ **Multi-Session Support** - Users can have multiple active sessions  
✅ **Auto-Cleanup** - Inactive sessions automatically marked inactive  
✅ **Real-time Dashboard** - View all active & historical sessions  

### Security Features (Premium)
🔒 **IP Geolocation** - Get country, city, ISP from IP addresses  
🔒 **Threat Detection** - Identify VPN, proxy, and threat IPs  
🔒 **Geo-Fencing** - Block/allow logins by country  
🔒 **Security Scoring** - Risk analysis for each login  
🔒 **Auto-Blocking** - Prevent logins from high-risk locations  
🔒 **Email Alerts** - Notify users of suspicious login attempts  
🔒 **Webhook Notifications** - Send Discord/Slack alerts on key events  

### Admin Dashboard
📊 **Active Sessions** - Real-time view of logged-in users  
📊 **Analytics** - Session trends, concurrent users, geo-heatmap  
📊 **Settings** - Configure timeouts, notifications, geo-restrictions  
📊 **License Management** - Built-in license activation interface  

### Non-Invasive Architecture
✅ **No Core Modifications** - Pure plugin, zero changes to Strapi core  
✅ **Runtime Injection** - Middleware-based architecture  
✅ **DB-Backed** - Uses `plugin::magic-sessionmanager.session` content type  
✅ **License-Based** - Premium features via license key  

---

## 🚀 Quick Start

### 1. Install Plugin

```bash
npm install strapi-plugin-magic-sessionmanager
# or
yarn add strapi-plugin-magic-sessionmanager
```

### 2. Register in Config

Add to `src/config/plugins.ts` (or `plugins.js`):

```typescript
export default () => ({
  'magic-sessionmanager': {
    enabled: true,
    resolve: './src/plugins/magic-sessionmanager',
    config: {
      // Optional: rate limit for lastSeen updates (ms)
      lastSeenRateLimit: 30000, // 30 seconds (default)
      
      // Optional: session inactivity timeout (ms)
      inactivityTimeout: 15 * 60 * 1000, // 15 minutes (default)
    },
  },
});
```

### 3. Build & Run

```bash
# Install dependencies
npm install

# Build the plugin (includes admin UI)
npm run build

# Start Strapi
npm run develop
```

### 4. Configure Encryption (Important!) 🔐

Generate a secure encryption key for JWT token storage:

```bash
# Option 1: Use Admin Panel
# Go to Admin → Sessions → Settings → Security Settings
# Click "Generate Key" and copy to .env

# Option 2: Generate manually
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Add to .env file:
SESSION_ENCRYPTION_KEY=your-generated-32-char-key-here
```

**Why this is important:**
- JWT tokens are encrypted before storing in database
- Prevents token exposure if database is compromised
- Uses AES-256-GCM encryption standard

### 5. Access Admin Dashboard

- Navigate to Strapi Admin: `http://localhost:1337/admin`
- Find **Sessions** in the left sidebar under plugins
- Start with the **License** tab to activate your license
- Go to **Settings → Security** to generate your encryption key

---

## 🔄 How It Works

### Architecture Overview

Magic Session Manager works by **intercepting Strapi's native authentication routes** WITHOUT replacing them. It uses middleware to hook into the authentication flow:

```
┌─────────────────────────────────────────────────────────┐
│ Client sends:                                           │
│ POST /api/auth/local                                    │
│ { identifier: "user@example.com", password: "pass123" }│
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Strapi's Native Auth (users-permissions plugin)        │
│ - Validates credentials                                 │
│ - Creates JWT token                                     │
│ - Returns: { jwt: "...", user: {...} }                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Magic Session Manager Middleware (AFTER auth)          │
│ - Detects successful login (status 200 + user object)  │
│ - Extracts: IP, User Agent, JWT Token                  │
│ - [PREMIUM] Checks IP geolocation & threat level       │
│ - [PREMIUM] Applies geo-fencing rules                  │
│ - Creates session record in database                    │
│ - [PREMIUM] Sends notifications (email/webhook)        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Response returned to client (unchanged)                 │
│ { jwt: "...", user: {...} }                            │
└─────────────────────────────────────────────────────────┘
```

### Login Flow (Detailed)

```
User Login Request
       ↓
[POST /api/auth/local]
  Body: { identifier, password }
       ↓
Strapi Auth validates credentials
       ↓
✅ Success → Strapi creates JWT token
       ↓
Strapi prepares response: { jwt, user }
       ↓
[Magic Session Manager Middleware INTERCEPTS]
       ↓
Extract from response:
  - user.id
  - ctx.body.jwt (Access Token)
  - IP address (from headers/proxies)
  - User Agent (browser info)
       ↓
[PREMIUM] Check IP Geolocation:
  - Get country, city, ISP
  - Detect VPN/Proxy/Threat
  - Calculate security score (0-100)
  - Apply geo-fencing rules
       ↓
[PREMIUM] Auto-blocking if:
  - Known threat IP (isThreat = true)
  - VPN detected (isVpn = true)
  - Country blocked (not in allowlist)
  - Security score < 50
       ↓
Block? NO → Continue ✅
Block? YES → Return 403 Forbidden ❌
       ↓
Create plugin::magic-sessionmanager.session record:
  {
    user: userId,
    token: jwt,          // Access Token
    ipAddress: "192.168.1.100",
    userAgent: "Mozilla/5.0...",
    loginTime: now,
    lastActive: now,
    isActive: true,
    geoLocation: {...},  // Premium
    securityScore: 95    // Premium
  }
       ↓
[PREMIUM] Send notifications:
  - Email alert (if suspicious)
  - Webhook (Discord/Slack)
       ↓
Return response to client (unchanged):
  { jwt: "...", user: {...} }
```

### Logout Flow

Magic Session Manager **replaces** the default `/api/auth/logout` route:

```
User Logout Request
       ↓
[POST /api/auth/logout]
  Headers: { Authorization: "Bearer <JWT>" }
       ↓
Magic Session Manager Handler (NOT Strapi's default)
       ↓
Extract JWT from Authorization header
       ↓
Find matching session:
  WHERE token = jwt AND isActive = true
       ↓
Found? YES → Update session:
  {
    isActive: false,
    logoutTime: now
  }
       ↓
Found? NO → Continue anyway (idempotent)
       ↓
Return: { message: "Logged out successfully" }
```

### Activity Tracking

Every authenticated request updates `lastActive`:

```
Authenticated API Request
  (Any route with valid JWT)
       ↓
[LastSeen Middleware - BEFORE request]
       ↓
Check: Does user have active session?
  WHERE user.id = X AND isActive = true
       ↓
NO active sessions?
  → Reject: 401 Unauthorized
  → Message: "All sessions terminated. Please login again."
       ↓
Has active session? Continue ✅
       ↓
[Process actual request]
       ↓
[LastSeen Middleware - AFTER request]
       ↓
Check: Was lastActive updated < 30s ago?
  (Rate limiting to prevent DB noise)
       ↓
YES (recently updated) → Skip ⏭️
NO (old timestamp) → Update session:
  {
    lastActive: now
  }
       ↓
Request complete
```

### Periodic Cleanup

Runs automatically every 30 minutes:

```
Cleanup Job (every 30 min)
       ↓
Find sessions where:
  lastActive < (now - inactivityTimeout)
  AND isActive = true
       ↓
For each inactive session:
  Update: isActive = false
       ↓
Log: "Cleaned up X inactive sessions"
```

---

## 🔌 Strapi Integration

### Routes Integration

#### Native Strapi Routes (Intercepted)

| Route | Method | Magic Session Manager Action |
|-------|--------|------------------------------|
| `/api/auth/local` | `POST` | **Intercepted** - Middleware runs AFTER Strapi auth creates JWT, then creates session |
| `/api/auth/local/register` | `POST` | **Intercepted** - Same as login (auto-login after registration) |

#### Overridden Routes

| Route | Method | Magic Session Manager Action |
|-------|--------|------------------------------|
| `/api/auth/logout` | `POST` | **Replaced** - Custom handler terminates session by JWT token |

#### Plugin Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/magic-sessionmanager/logout` | `POST` | Alternative logout endpoint |
| `/api/magic-sessionmanager/logout-all` | `POST` | Logout from all devices |
| `/api/magic-sessionmanager/sessions` | `GET` | Get user's sessions |
| `/api/magic-sessionmanager/user/:id/sessions` | `GET` | Get sessions for specific user |

### JWT Token Handling

#### Access Tokens (JWT)
- **Stored:** YES - in `session.token` field
- **Used for:** Matching sessions during logout
- **Expiration:** Controlled by Strapi's JWT config
- **Validation:** Done by Strapi's auth system (not the plugin)

**Important:** When a JWT expires, the session becomes orphaned but remains `isActive = true` until:
1. User explicitly logs out
2. Inactivity timeout triggers cleanup
3. Admin terminates the session

#### Refresh Tokens ✅ **SOLVED!**

**What are Refresh Tokens?**
Refresh tokens allow users to get new Access Tokens (JWTs) without re-entering credentials. This enables longer sessions:

```
Access Token expires after 30 min
       ↓
User still has Refresh Token
       ↓
User requests new Access Token:
POST /api/auth/refresh
       ↓
Strapi issues new JWT
       ↓
User continues without re-login
```

**The Solution (v3.2+):**
- **Stored:** YES - Refresh tokens are encrypted and stored with sessions ✅
- **Tracked:** YES - Middleware intercepts `/api/auth/refresh` requests ✅
- **Validated:** YES - Checks if session is still active before issuing new tokens ✅

**How It Works:**

```
Login: User gets JWT + Refresh Token
       ↓
Both tokens encrypted and stored in session
       ↓
Admin terminates session
       ↓
Session: isActive = false ❌
       ↓
User tries to refresh token:
POST /api/auth/refresh
{ refreshToken: "..." }
       ↓
[Refresh Token Middleware]
       ↓
Decrypt all active session refresh tokens
       ↓
Find matching session
       ↓
Session found but isActive = false?
  → BLOCK! Return 401 Unauthorized ❌
  → Message: "Session terminated. Please login again."
       ↓
Session found and isActive = true?
  → ALLOW! ✅
  → Strapi issues new tokens
  → Session updated with new encrypted tokens
```

**Security Benefits:**

✅ **Session termination is FINAL** - User cannot get new tokens  
✅ **Refresh tokens tracked** - Encrypted & stored securely  
✅ **Token rotation** - New tokens automatically updated in session  
✅ **Admin control** - Force logout works even with refresh tokens  

**Configuration:**

Enable refresh tokens in Strapi:

```typescript
// src/config/plugins.ts
export default () => ({
  'users-permissions': {
    config: {
      jwtManagement: 'refresh',  // Enable refresh tokens
      sessions: {
        accessTokenLifespan: 3600,    // 1 hour (in seconds)
        maxRefreshTokenLifespan: 2592000,  // 30 days
        idleRefreshTokenLifespan: 604800,  // 7 days idle
      },
    },
  },
  'magic-sessionmanager': {
    enabled: true,
    config: {
      inactivityTimeout: 15 * 60 * 1000, // 15 minutes
    },
  },
});
```

**Testing Refresh Token Blocking:**

```bash
# 1. Login and get tokens
curl -X POST http://localhost:1337/api/auth/local \
  -H "Content-Type: application/json" \
  -d '{"identifier":"user@example.com","password":"pass"}' 

# Save both tokens:
ACCESS_TOKEN="eyJhbGci..."
REFRESH_TOKEN="abc123..."

# 2. Admin terminates session
# Go to Admin → Sessions → Find session → Terminate

# 3. Try to refresh token
curl -X POST http://localhost:1337/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}"

# Expected: 401 Unauthorized
# "Session terminated. Please login again."
```

**This completely solves the refresh token security gap!** 🔒

### Without Refresh Tokens (Default Behavior)

If you **don't enable** refresh tokens (`jwtManagement: 'refresh'`):

```
Login: User gets JWT (no refresh token)
       ↓
JWT stored in session (encrypted)
       ↓
JWT expires after 30 min (or configured time)
       ↓
User must re-login ❌
       ↓
No automatic token refresh
```

**Behavior:**
- ✅ Session Manager works normally
- ✅ Sessions tracked, logout works
- ✅ Force logout works (no refresh token bypass possible)
- ⚠️ Users must re-login when JWT expires
- ℹ️ No refresh token middleware runs (skipped)

**Logs when refresh tokens disabled:**
```
[magic-sessionmanager] ✅ Session created for user 1 (IP: 192.168.1.1)
[magic-sessionmanager] ℹ️  No refresh token in response (JWT management not enabled)
[magic-sessionmanager] ✅ Refresh Token interceptor middleware mounted
```

**If you try to call `/api/auth/refresh` without enabling it:**
- Endpoint returns **404 Not Found** (Strapi doesn't create the route)
- Or returns **401 Unauthorized** if route exists but tokens not configured
- This is expected and correct behavior

**Trade-offs:**

| Feature | With Refresh Tokens | Without Refresh Tokens |
|---------|---------------------|------------------------|
| User Experience | ✅ Seamless (auto-refresh) | ⚠️ Must re-login |
| Security | ✅ Tracked & blockable | ✅ No bypass risk |
| Session Duration | Long (days/weeks) | Short (hours) |
| Force Logout | ✅ Complete | ✅ Complete |

**Recommendation:**

**Enable refresh tokens** for better UX + use this plugin to secure them! 🔒

**Testing in Postman:**

```
1. Login (get JWT + refreshToken)
   POST /api/auth/local
   → Save: jwt, refreshToken, session_id

2. Refresh Token (should work)
   POST /api/auth/refresh
   Body: { "refreshToken": "..." }
   → Returns: New jwt + refreshToken ✅

3. Admin terminates session
   POST /magic-sessionmanager/sessions/:id/terminate
   
4. Try refresh token again
   POST /api/auth/refresh
   Body: { "refreshToken": "..." }
   → Returns: 401 Unauthorized ✅
   → Message: "Session terminated. Please login again."
```

**Run Automated Test:**

```bash
cd /path/to/magic-sessionmanager

# Set environment variables
export TEST_USER_EMAIL=user@example.com
export TEST_USER_PASSWORD=password123
export ADMIN_EMAIL=admin@example.com
export ADMIN_PASSWORD=adminpass

# Run test suite
node test-session-manager.js

# Look for "USER TEST 5: Blocked Refresh Token Test"
# Should show: ✅ Refresh token BLOCKED as expected!

# Note: Tests include delays to avoid rate limiting
# Total runtime: ~45-60 seconds (includes 8s pause before refresh token test)
```

**Troubleshooting Tests:**

If you get "Too many requests":
- Tests include 1-5 second delays between requests (8s before final test)
- Strapi may have aggressive rate limiting enabled
- **Wait 3-5 minutes** and run tests again
- Or disable rate limiting in Strapi config temporarily for testing
- Or run individual tests instead of full suite

### Multi-Login Behavior

**Strapi Default:** Allows multiple simultaneous logins
**Magic Session Manager:** Tracks each login as separate session

```
User logs in from:
- Desktop (Chrome) → Session 1
- Mobile (Safari) → Session 2
- Laptop (Firefox) → Session 3

All sessions are active simultaneously.
User can logout from one device without affecting others.
```

### Magic Link Integration

If you use `strapi-plugin-magic-link`, the session manager automatically detects Magic Link logins:

```javascript
// bootstrap.js line 140
const isMagicLink = ctx.path.includes('/magic-link/login') && ctx.method === 'POST';
```

Sessions are created the same way for Magic Link logins.

---

## 🎛️ Admin Dashboard

Access at **Admin → Sessions** (sidebar plugin)

### Tabs Overview

#### 1. 📊 **Active Sessions**
- Real-time list of currently logged-in users
- Shows: User, IP, Device, Login Time, Last Seen
- Actions: Terminate session, View details
- Live status indicators

**Features:**
- Filter by user, device, location
- Sort by login time, last activity
- Bulk actions (terminate multiple)
- Export to CSV

#### 2. 📈 **Analytics**
- Total sessions today/this week/this month
- Concurrent users graph (real-time)
- Geo-heatmap (Premium - shows login locations)
- Device/browser breakdown
- Peak usage times
- Average session duration

#### 3. ⚙️ **Settings**

**Basic Settings:**
- Rate limits (lastSeen update frequency)
- Inactivity timeout
- Cleanup schedule

**Premium Settings:**
- License key activation
- Geolocation enabled
- Security scoring enabled
- Auto-blocking suspicious logins
- VPN/Proxy alerts

**Notification Settings:**
- Email alerts configuration
- Suspicious login alerts
- Discord webhook URL
- Slack webhook URL

**Geo-Fencing:**
- Country allow/block lists
- IP whitelist/blacklist

#### 4. 🔑 **License**
- Activate license key
- View license status & expiry
- Offline mode information
- License holder details
- Auto-ping status (15-minute intervals)

---

## 📡 API Routes

### Content API Routes

All require valid JWT authentication (Bearer token).

#### Get User Sessions

```bash
GET /api/magic-sessionmanager/sessions
Authorization: Bearer YOUR_JWT

Response:
{
  "data": [
    {
      "id": 1,
      "attributes": {
        "loginTime": "2024-01-15T10:30:00Z",
        "lastActive": "2024-01-15T10:35:45Z",
        "logoutTime": null,
        "isActive": true,
        "ipAddress": "192.168.1.100",
        "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
        "token": "eyJhbGciOiJIUzI1NiIs...", // JWT Access Token
        "geoLocation": {  // Premium
          "country": "Germany",
          "city": "Berlin",
          "country_code": "DE",
          "latitude": 52.52,
          "longitude": 13.41
        },
        "securityScore": 95 // Premium
      },
      "relationships": {
        "user": { "id": 1, "username": "john" }
      }
    }
  ],
  "meta": { "count": 3 }
}
```

#### Logout (Method 1 - Strapi Native)

```bash
POST /api/auth/logout
Authorization: Bearer YOUR_JWT

Response:
{
  "message": "Logged out successfully"
}

# This is the REPLACED Strapi route
# Terminates session matching the JWT token
```

#### Logout (Method 2 - Plugin Endpoint)

```bash
POST /api/magic-sessionmanager/logout
Authorization: Bearer YOUR_JWT

Response:
{
  "message": "Session terminated successfully"
}

# Alternative endpoint with same behavior
```

#### Logout All Devices

```bash
POST /api/magic-sessionmanager/logout-all
Authorization: Bearer YOUR_JWT

Response:
{
  "message": "All sessions terminated",
  "count": 3
}

# Terminates ALL active sessions for the user
# Useful for "logout everywhere" feature
```

---

### Admin API Routes

All require **admin authentication**.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/magic-sessionmanager/admin/sessions` | Get all sessions (all users) |
| `GET` | `/magic-sessionmanager/admin/sessions/active` | Get only active sessions |
| `GET` | `/magic-sessionmanager/admin/user/:userId/sessions` | Get sessions for a user |
| `POST` | `/magic-sessionmanager/admin/sessions/:sessionId/terminate` | Mark session inactive |
| `DELETE` | `/magic-sessionmanager/admin/sessions/:sessionId` | Permanently delete session |
| `POST` | `/magic-sessionmanager/admin/sessions/clean-inactive` | Delete all inactive sessions |
| `POST` | `/magic-sessionmanager/admin/user/:userId/terminate-all` | Logout user everywhere |
| `GET` | `/magic-sessionmanager/admin/geolocation/:ipAddress` | Get IP info (Premium) |
| `GET` | `/magic-sessionmanager/admin/settings` | Get plugin settings |
| `PUT` | `/magic-sessionmanager/admin/settings` | Update plugin settings |
| `GET` | `/magic-sessionmanager/admin/license/status` | Get license status |
| `POST` | `/magic-sessionmanager/admin/license/activate` | Activate license |

---

## ⚙️ Configuration

### Basic Config

```typescript
// src/config/plugins.ts
export default () => ({
  'magic-sessionmanager': {
    enabled: true,
    config: {
      // Rate limit for lastSeen updates (milliseconds)
      // Prevents excessive DB writes
      lastSeenRateLimit: 30000, // 30 seconds (default)
      
      // Session inactivity timeout (milliseconds)
      // Sessions inactive longer than this are marked inactive
      inactivityTimeout: 15 * 60 * 1000, // 15 minutes (default)
      
      // IMPORTANT: Set this LOWER than your JWT expiration
      // to prevent orphaned sessions
    },
  },
});
```

### Relationship with JWT Config

```typescript
// src/config/plugins.ts
export default () => ({
  // Strapi JWT Configuration
  'users-permissions': {
    config: {
      jwt: {
        expiresIn: '30m', // Access Token expires after 30 minutes
      },
    },
  },
  
  // Session Manager Configuration
  'magic-sessionmanager': {
    enabled: true,
    config: {
      // Set inactivity timeout LOWER than JWT expiration
      // This prevents orphaned sessions when JWT expires
      inactivityTimeout: 15 * 60 * 1000, // 15 minutes < 30 minutes JWT
      
      // Or match JWT expiration exactly:
      // inactivityTimeout: 30 * 60 * 1000, // 30 minutes = JWT expiration
    },
  },
});
```

### Premium Config

Available through Admin UI **Settings → Sessions → Settings**:

```typescript
// Settings stored in database via Admin UI
{
  // Geolocation & Security
  enableGeolocation: true,
  enableSecurityScoring: true,
  blockSuspiciousSessions: true,
  alertOnVpnProxy: true,
  
  // Geo-Fencing
  enableGeofencing: true,
  allowedCountries: ["DE", "AT", "CH"], // Germany, Austria, Switzerland
  blockedCountries: ["RU", "CN"],       // Russia, China
  
  // Notifications
  enableEmailAlerts: true,
  alertOnSuspiciousLogin: true,
  enableWebhooks: true,
  discordWebhookUrl: "https://discord.com/api/webhooks/...",
  slackWebhookUrl: "https://hooks.slack.com/services/...",
}
```

---

## 🔐 JWT Token Security

### Encryption

All JWT tokens are **encrypted before storing** in the database using **AES-256-GCM** encryption.

#### Why Encrypt Tokens?

```
❌ Without Encryption:
Database compromised → Attacker sees JWTs → Can impersonate users!

✅ With Encryption:
Database compromised → Attacker sees encrypted data → Useless without key!
```

#### How It Works

```
Login: User gets JWT
       ↓
JWT: "eyJhbGciOiJIUzI1NiIs..."
       ↓
[Encrypt with AES-256-GCM]
       ↓
Encrypted: "a3f7b2c1:8c4d9e2a:f2a5b8c3d4e5f6a7..."
       ↓
Stored in Database (secure!)

Logout: User sends JWT
       ↓
[Fetch all active sessions from DB]
       ↓
[Decrypt each token]
       ↓
[Compare with user's JWT]
       ↓
Match found → Terminate session ✅
```

#### Configuration

**Generate Encryption Key (Admin Panel):**

1. Go to **Admin → Sessions → Settings**
2. Open **Security Settings** accordion
3. Find **JWT Encryption Key Generator**
4. Click **"Generate Key"**
5. Copy key with **"Copy for .env"** button
6. Add to your `.env` file

**Or generate manually:**

```bash
# Generate secure 32-byte key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Add to .env
SESSION_ENCRYPTION_KEY=aBc123XyZ...your-32-char-key
```

**Fallback Behavior:**

If `SESSION_ENCRYPTION_KEY` is not set:
- Plugin uses `APP_KEYS` or `API_TOKEN_SALT` as fallback
- ⚠️ Warning logged on startup
- Still encrypted, but key is derived from Strapi's keys

**Production Recommendation:**
Always use a dedicated `SESSION_ENCRYPTION_KEY` for better security isolation.

#### Security Details

| Feature | Value |
|---------|-------|
| Algorithm | AES-256-GCM |
| Key Size | 256 bits (32 bytes) |
| IV Length | 128 bits (16 bytes) |
| Auth Tag | 128 bits (16 bytes) |
| Format | `iv:authTag:encryptedData` (hex) |

### Unique Session IDs

Each session gets a cryptographically unique identifier:

```javascript
sessionId: "sess_lx3k7_4f2a8b3c_a1b2c3d4e5f6"
//          prefix^  ^timestamp  ^user-hash  ^random-bytes
```

**Benefits:**
- ✅ No collisions across sessions
- ✅ Traceable session identifiers
- ✅ Independent from database IDs
- ✅ URL-safe for future features

---

## 🔒 Premium Features

### IP Geolocation & Threat Detection

Uses **ipapi.co** API for accurate IP information:

```json
{
  "country": "Germany",
  "country_code": "DE",
  "city": "Berlin",
  "latitude": 52.52,
  "longitude": 13.41,
  "isp": "Deutsche Telekom",
  "isVpn": false,
  "isProxy": false,
  "isThreat": false,
  "securityScore": 95,
  "threatType": null
}
```

### Auto-Blocking Rules

```
Login attempt from IP: 1.2.3.4
       ↓
[Geolocation Check]
       ↓
isThreat = true → BLOCK ❌
isVpn = true (if alertOnVpnProxy) → BLOCK ❌
country = "RU" (if in blockedCountries) → BLOCK ❌
country ≠ ["DE","AT","CH"] (if allowedCountries set) → BLOCK ❌
securityScore < 50 → BLOCK ❌
       ↓
None of above? → ALLOW ✅
```

### Email Alerts

```
Subject: ⚠️ Unusual Login Activity

Hi John,

A login from a new location was detected:

📍 Location: Berlin, Germany
🌐 IP Address: 192.168.1.100
🔒 Risk Level: Medium (VPN detected)
⏰ Time: 2024-01-15 10:30:00 UTC
💻 Device: Chrome on Windows

If this wasn't you, secure your account immediately.

— Magic Session Manager
```

### Webhook Notifications

**Discord:**
```
🔓 NEW LOGIN
━━━━━━━━━━━━━━━━━━
User: john@example.com
IP: 192.168.1.100
Location: Berlin, Germany
Risk: ⚠️ Medium (VPN)
Browser: Chrome / Windows
Time: 2024-01-15 10:30:00
```

---

## 💡 Use Cases

### Force Logout

```bash
# Admin terminates specific session
POST /api/magic-sessionmanager/admin/sessions/123/terminate

# Admin logs out user from all devices
POST /api/magic-sessionmanager/admin/user/5/terminate-all

# Next API request from that user:
GET /api/some-endpoint
Authorization: Bearer <their JWT>

# Response: 401 Unauthorized
# "All sessions have been terminated. Please login again."
```

### Security Monitoring

```
Premium feature: VPN Detection
       ↓
User logs in from VPN
       ↓
isVpn = true detected
       ↓
Email sent: "Suspicious login from VPN"
       ↓
Webhook notification to Slack
       ↓
Admin reviews in dashboard
       ↓
Admin can terminate session if needed
```

### Compliance Audit

```
Export all sessions to CSV:
- Who logged in
- When & where (IP, location)
- Device & browser used
- Session duration
- Logout time (if any)

Perfect for compliance requirements!
```

---

## 🧪 Testing

### 1. Test Login & Session Creation

```bash
# Login via Strapi's native route
curl -X POST http://localhost:1337/api/auth/local \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "test@example.com",
    "password": "Test@123"
  }'

# Response:
{
  "jwt": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 1, "email": "test@example.com", ... }
}

# Save JWT
export JWT="eyJhbGciOiJIUzI1NiIs..."

# Check session was created
curl http://localhost:1337/api/magic-sessionmanager/sessions \
  -H "Authorization: Bearer $JWT"

# Should show new session with:
# - loginTime
# - isActive: true
# - ipAddress
# - userAgent
# - token (matches JWT)
```

### 2. Test Activity Tracking

```bash
# First request (updates lastActive)
curl http://localhost:1337/api/users \
  -H "Authorization: Bearer $JWT"

# Check lastActive timestamp
curl http://localhost:1337/api/magic-sessionmanager/sessions \
  -H "Authorization: Bearer $JWT"

# Wait 35 seconds (> 30s rate limit)
sleep 35

# Second request (should update lastActive)
curl http://localhost:1337/api/users \
  -H "Authorization: Bearer $JWT"

# Check lastActive changed
curl http://localhost:1337/api/magic-sessionmanager/sessions \
  -H "Authorization: Bearer $JWT"
```

### 3. Test Logout

```bash
# Logout via Strapi's route (replaced by plugin)
curl -X POST http://localhost:1337/api/auth/logout \
  -H "Authorization: Bearer $JWT"

# Response: { "message": "Logged out successfully" }

# Check session is inactive
curl http://localhost:1337/api/magic-sessionmanager/sessions \
  -H "Authorization: Bearer $JWT"

# Should show:
# - isActive: false
# - logoutTime: (timestamp)
```

### 4. Test Force Logout

```bash
# User A terminates all their sessions
curl -X POST http://localhost:1337/api/magic-sessionmanager/logout-all \
  -H "Authorization: Bearer $JWT_A"

# Try to use API with old JWT
curl http://localhost:1337/api/users \
  -H "Authorization: Bearer $JWT_A"

# Response: 401 Unauthorized
# "All sessions have been terminated. Please login again."
```

---

## 🐛 Troubleshooting

### Sessions Not Creating

**Problem:** Login succeeds but no session record appears.

**Solutions:**
1. Check Strapi logs:
   ```bash
   npm run develop
   # Look for: [magic-sessionmanager] 🔍 Login detected!
   # Look for: [magic-sessionmanager] ✅ Session X created
   ```

2. Verify middleware is mounted:
   ```bash
   # Look for: [magic-sessionmanager] ✅ Login/Logout interceptor middleware mounted
   ```

3. Check `plugin::magic-sessionmanager.session` collection exists:
   - Go to Admin → Content Manager
   - Look for "Session" collection

### JWT Still Works After Logout

**Problem:** After logout, JWT still authenticates API requests.

**Explanation:** This is EXPECTED behavior!
- JWT tokens are **stateless** - validated by signature alone
- Plugin marks session `isActive = false`
- But JWT itself remains valid until expiration
- Next authenticated request is **blocked** by LastSeen middleware

**Solution:** This is by design. The middleware blocks requests from users with no active sessions.

### Orphaned Sessions

**Problem:** Sessions remain `isActive = true` after JWT expires.

**Cause:** JWT expiration > inactivity timeout

**Solution:**
```typescript
// Set inactivity timeout LOWER than JWT expiration
{
  'magic-sessionmanager': {
    config: {
      inactivityTimeout: 15 * 60 * 1000 // 15 min (if JWT = 30 min)
    }
  }
}
```

### LastSeen Not Updating

**Problem:** `lastActive` timestamp doesn't change.

**Solutions:**
1. Check rate limit:
   ```typescript
   config: {
     lastSeenRateLimit: 5000 // Lower for testing
   }
   ```

2. Wait longer than rate limit (default 30s)

3. Verify middleware mounted:
   ```bash
   # Look for: [magic-sessionmanager] ✅ LastSeen middleware mounted
   ```

---

## 🛠️ Development

### Plugin Structure

```
magic-sessionmanager/
├── server/src/
│   ├── bootstrap.js           # ⚙️ CORE: Mounts middlewares & intercepts routes
│   ├── middlewares/
│   │   └── last-seen.js       # 🔄 Updates lastActive on each request
│   ├── services/
│   │   ├── session.js         # 💾 Session CRUD operations
│   │   ├── geolocation.js     # 🌍 IP geolocation (Premium)
│   │   ├── notifications.js   # 📧 Email/webhook alerts
│   │   └── license-guard.js   # 🔑 License validation
│   ├── controllers/
│   │   ├── session.js         # 🎮 Session API handlers
│   │   ├── settings.js        # ⚙️ Settings API
│   │   └── license.js         # 🔑 License API
│   ├── routes/
│   │   ├── content-api.js     # 🌐 User-facing routes
│   │   └── admin.js           # 👑 Admin-only routes
│   └── utils/
│       └── getClientIp.js     # 📍 IP extraction (proxy-aware)
│
├── admin/src/
│   ├── pages/
│   │   ├── HomePage.jsx       # 📊 Main dashboard
│   │   ├── ActiveSessions.jsx # 👥 Active sessions tab
│   │   ├── Analytics.jsx      # 📈 Analytics tab
│   │   ├── Settings.jsx       # ⚙️ Settings tab
│   │   └── License.jsx        # 🔑 License tab
│   └── components/
│       ├── SessionDetailModal.jsx
│       └── LicenseGuard.jsx
│
├── .github/workflows/
│   ├── semantic-release.yml   # 🚀 NPM publishing
│   └── test.yml               # ✅ CI/CD tests
│
├── package.json
├── .releaserc.json            # 📦 semantic-release config
└── README.md
```

### Build & Release

```bash
# Build
npm run build

# Release (automatic via semantic commits)
git commit -m "feat: add new feature"    # → MINOR
git commit -m "fix: fix bug"             # → PATCH
git commit -m "feat!: breaking change"   # → MAJOR
```

---

## 📦 NPM Release Process

Uses **semantic-release** for automated versioning.

### Commit Format

```bash
feat: add geo-fencing support       # → v1.1.0
fix: correct session cleanup        # → v1.0.1
feat!: change API response format   # → v2.0.0
```

GitHub Actions automatically publishes to NPM on push to `main`.

---

## 📚 Resources

- **NPM:** https://www.npmjs.com/package/strapi-plugin-magic-sessionmanager
- **GitHub:** https://github.com/Schero94/Magic-Sessionmanager
- **Issues:** https://github.com/Schero94/Magic-Sessionmanager/issues

---

## 📄 License

**MIT License** - Free for personal & commercial use

**Copyright (c) 2025 Schero D.**

---

**Built with ❤️ for Strapi v5**
