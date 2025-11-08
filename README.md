# Magic Session Manager 🔐

**Advanced Session Management for Strapi v5** - Track user logins, sessions, and online status without modifying core Strapi files. Enterprise-ready with optional geolocation, security scoring, and notifications.

---

## 📋 Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Core Concepts](#core-concepts)
- [API Routes](#api-routes)
- [Configuration](#configuration)
- [Admin Dashboard](#admin-dashboard)
- [Premium Features](#premium-features)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## ✨ Features

### Core Session Management
✅ **Automatic Session Tracking** - Sessions created on login, terminated on logout  
✅ **Session History** - Complete record of all user login/logout events with IP & browser info  
✅ **Activity Monitoring** - Track last seen time with configurable rate limiting  
✅ **Multi-Session Support** - Users can have multiple active sessions simultaneously  
✅ **Inactivity Auto-Cleanup** - Sessions automatically marked inactive after timeout  

### Admin Dashboard
✅ **Real-time Session Viewer** - View all active & historical sessions  
✅ **User Isolation** - See sessions per user in the Content Manager sidebar  
✅ **Session Control** - Terminate specific sessions or all sessions for a user  
✅ **IP & Device Info** - Display client IP, user agent, and browser details  

### Security Features (Premium)
✅ **IP Geolocation** - Get country, city, ISP, and security threats from IP addresses  
✅ **Geo-Fencing** - Block/allow logins by country  
✅ **Suspicious Activity Detection** - Identify VPN, proxy, and threat IPs  
✅ **Auto-Blocking** - Prevent logins from high-risk locations  
✅ **Email Alerts** - Notify users of suspicious login attempts  
✅ **Webhook Notifications** - Send Discord/Slack alerts on key events  

### Non-Invasive Architecture
✅ **No Core Modifications** - Pure plugin, zero changes to Strapi core files  
✅ **Runtime Injection** - Middleware-based architecture  
✅ **DB-Backed Storage** - Uses Strapi's `api::session.session` content type  
✅ **License-Based** - Premium features available via license key  

---

## 🚀 Quick Start

### 1. Install Plugin

Place the plugin in your Strapi project:

```bash
# Copy plugin to Strapi
cp -r magic-sessionmanager YOUR_STRAPI_PROJECT/src/plugins/

# Or clone from repo
cd YOUR_STRAPI_PROJECT/src/plugins
git clone <repo-url> magic-sessionmanager
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
npm run build --workspace=src/plugins/magic-sessionmanager

# Start Strapi
npm run develop
```

### 4. Access Admin Dashboard

- Navigate to Strapi Admin: `http://localhost:1337/admin`
- Find **Sessions** in the left sidebar under plugins
- Start with the **License** tab to activate your license

---

## 🔄 How It Works

### Login Flow

```
User Login Request
       ↓
[/api/auth/local] POST
       ↓
Strapi Auth Service (existing)
       ↓
✅ Auth Successful → Session Manager Middleware intercepts response
       ↓
Extract: User ID, IP, User Agent, JWT Token
       ↓
Create api::session.session record
       ↓
Return Login Response (user + jwt)
```

### Logout Flow

```
User Logout Request
       ↓
[/api/auth/logout] POST with JWT Token
       ↓
Session Manager finds matching session by token
       ↓
Update session: isActive = false, logoutTime = now
       ↓
Return Success Response
```

### Activity Tracking

```
Authenticated API Request
       ↓
[LastSeen Middleware]
       ↓
Check: Is lastSeen > 30 seconds old? (configurable)
       ↓
✅ Yes → Update lastSeen timestamp in session
❌ No → Skip (prevent DB noise)
       ↓
Continue request
```

### Periodic Cleanup

```
Every 30 minutes (automatic)
       ↓
Find inactive sessions (no activity > inactivityTimeout)
       ↓
Mark: isActive = false
       ↓
Log cleanup results
```

---

## 🔑 Core Concepts

### Sessions Collection

All session data stored in `api::session.session` (a Strapi content type):

```javascript
{
  id: 1,
  user: { id: 1, email: "user@example.com" },
  
  // Login Info
  loginTime: "2024-01-15T10:30:00Z",
  logoutTime: null, // null if still active
  lastActive: "2024-01-15T10:35:45Z",
  
  // Client Info
  ipAddress: "192.168.1.100",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
  token: "eyJhbGciOiJIUzI1NiIs...", // JWT reference
  
  // Status
  isActive: true,
  
  // Premium Features
  geoLocation: { country: "DE", city: "Berlin", isp: "Telekom" },
  securityScore: 85,
  isBlocked: false,
}
```

### Middleware Stack

| Middleware | Purpose | When |
|-----------|---------|------|
| **Login Interceptor** | Catches successful logins, creates session | After `/api/auth/local` succeeds |
| **Logout Handler** | Terminates sessions via `/api/auth/logout` | When user initiates logout |
| **LastSeen Updater** | Tracks activity, updates `lastActive` field | Every authenticated request |
| **Cleanup Job** | Removes inactive sessions | Every 30 minutes |

### Rate Limiting (lastSeen)

Prevents excessive database writes:

```
Request 1 at 10:00:00 → Update lastSeen to 10:00:00 ✓
Request 2 at 10:00:05 → Skipped (< 30s) ✗
Request 3 at 10:00:15 → Skipped (< 30s) ✗
Request 4 at 10:00:35 → Update lastSeen to 10:00:35 ✓ (30s passed)
```

---

## 📡 API Routes

### Content API Routes

All require valid JWT authentication (Bearer token).

#### Get Active Sessions

```bash
GET /api/magic-sessionmanager/sessions

Response:
{
  "data": [
    {
      "id": 1,
      "attributes": {
        "loginTime": "2024-01-15T10:30:00Z",
        "lastActive": "2024-01-15T10:35:45Z",
        "isActive": true,
        "ipAddress": "192.168.1.100",
        "userAgent": "Mozilla/5.0..."
      },
      "relationships": {
        "user": { "id": 1, "username": "john" }
      }
    }
  ],
  "meta": { "count": 1 }
}
```

#### Get User Sessions

```bash
GET /api/magic-sessionmanager/user/:userId/sessions

# Example
GET /api/magic-sessionmanager/user/1/sessions
```

#### Logout User

```bash
POST /api/magic-sessionmanager/logout
Authorization: Bearer YOUR_JWT_TOKEN

Response:
{
  "message": "Logged out successfully"
}
```

#### Terminate Session (Admin)

```bash
POST /api/magic-sessionmanager/sessions/:sessionId/terminate
Authorization: Bearer ADMIN_JWT_TOKEN

# Marks session as inactive immediately
```

---

### Admin API Routes

All require **admin authentication**.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/magic-sessionmanager/admin/sessions` | Get all sessions (active + inactive) |
| `GET` | `/api/magic-sessionmanager/admin/sessions/active` | Get only active sessions |
| `GET` | `/api/magic-sessionmanager/admin/user/:userId/sessions` | Get sessions for a user |
| `POST` | `/api/magic-sessionmanager/admin/sessions/:sessionId/terminate` | Mark session inactive |
| `DELETE` | `/api/magic-sessionmanager/admin/sessions/:sessionId` | Permanently delete session |
| `POST` | `/api/magic-sessionmanager/admin/sessions/clean-inactive` | Delete all inactive sessions |
| `POST` | `/api/magic-sessionmanager/admin/user/:userId/terminate-all` | Logout user everywhere |
| `GET` | `/api/magic-sessionmanager/admin/geolocation/:ipAddress` | Get IP info (Premium) |
| `GET` | `/api/magic-sessionmanager/admin/settings` | Get plugin settings |
| `PUT` | `/api/magic-sessionmanager/admin/settings` | Update plugin settings |

---

## ⚙️ Configuration

### Basic Config (default)

```typescript
// src/config/plugins.ts
export default () => ({
  'magic-sessionmanager': {
    enabled: true,
    resolve: './src/plugins/magic-sessionmanager',
    config: {
      // Rate limit for lastSeen updates (milliseconds)
      lastSeenRateLimit: 30000, // Default: 30 seconds
      
      // Session inactivity timeout (milliseconds)
      // Sessions inactive for longer are marked as inactive
      inactivityTimeout: 15 * 60 * 1000, // Default: 15 minutes
    },
  },
});
```

### Premium Config (License Required)

Available through Admin UI **Settings → Sessions → Settings**:

#### Geolocation & Security
- `enableGeolocation` - Fetch IP geolocation data
- `enableSecurityScoring` - Analyze IP reputation
- `blockSuspiciousSessions` - Auto-block high-risk logins
- `alertOnVpnProxy` - Detect VPN/proxy attempts

#### Geo-Fencing
- `enableGeofencing` - Enable country restrictions
- `allowedCountries` - Whitelist countries (e.g., `["DE", "AT", "CH"]`)
- `blockedCountries` - Blacklist countries

#### Notifications
- `enableEmailAlerts` - Send email on suspicious login
- `alertOnSuspiciousLogin` - Email trigger for VPN/proxy/threat IPs
- `enableWebhooks` - Send webhook notifications
- `discordWebhookUrl` - Discord channel webhook URL
- `slackWebhookUrl` - Slack channel webhook URL

---

## 🎛️ Admin Dashboard

Access at **Admin → Sessions** (sidebar plugin)

### Tabs Overview

#### 1. **Active Sessions**
- Real-time list of currently logged-in users
- Shows: User, IP, Device, Login Time, Last Seen
- Actions: Terminate session, View details

#### 2. **All Sessions**
- Complete history (active + logged out sessions)
- Filter: Active only, Inactive only, All
- Export: Session records to CSV

#### 3. **Analytics**
- Total sessions today/this week/this month
- Concurrent users graph
- Geo-heatmap (Premium)
- Device/browser breakdown

#### 4. **Settings**
- Basic: Rate limits, timeouts
- Premium: License key, geolocation, notifications
- Webhooks: Discord/Slack configuration
- Geo-restrictions: Country allow/block lists

#### 5. **License**
- Activate license key
- View license status & expiry
- Offline mode information
- License holder details

---

## 🔒 Premium Features

### Requirements
- Valid license key from [https://magic-link.schero.dev](https://magic-link.schero.dev)
- License auto-validated via HTTPS on first login
- Offline grace period (continues working without internet for 7 days)

### Geolocation & Threats

Uses **IP2Location** or **MaxMind** API:

```json
{
  "country": "DE",
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

### Email Alerts

Sent when suspicious login detected:

```
Subject: ⚠️ Unusual Login Activity

Hi John,

A login from a new location was detected on your account:

📍 Location: Berlin, Germany (192.168.1.100)
🔒 Risk Level: Medium (VPN detected)
⏰ Time: 2024-01-15 10:30:00 UTC
🌐 Browser: Chrome on Windows

If this wasn't you, secure your account immediately.

— Magic Session Manager
```

### Webhook Notifications

Discord format:

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

## 🧪 Testing

### 1. Register a Test User

```bash
curl -X POST http://localhost:1337/api/auth/local/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "SecurePass123!"
  }'
```

### 2. Login & Get Session

```bash
curl -X POST http://localhost:1337/api/auth/local \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "test@example.com",
    "password": "SecurePass123!"
  }'

# Response:
# {
#   "jwt": "eyJhbGciOiJIUzI1NiIs...",
#   "user": { "id": 1, "email": "test@example.com", ... }
# }

# Save the JWT token for next requests
export JWT_TOKEN="eyJhbGciOiJIUzI1NiIs..."
```

### 3. Check Session Created

```bash
# View all active sessions (admin only)
curl http://localhost:1337/api/magic-sessionmanager/admin/sessions \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN"

# View your own sessions
curl http://localhost:1337/api/magic-sessionmanager/sessions \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### 4. Test Activity Tracking

```bash
# First request updates lastSeen
curl http://localhost:1337/api/users \
  -H "Authorization: Bearer $JWT_TOKEN"

# Wait 5 seconds, try again (should NOT update due to rate limit)
sleep 5
curl http://localhost:1337/api/users \
  -H "Authorization: Bearer $JWT_TOKEN"

# Wait 30+ seconds, try again (should update now)
sleep 30
curl http://localhost:1337/api/users \
  -H "Authorization: Bearer $JWT_TOKEN"

# Check: lastActive timestamp should have changed
```

### 5. Test Logout

```bash
curl -X POST http://localhost:1337/api/auth/logout \
  -H "Authorization: Bearer $JWT_TOKEN"

# Response: { "message": "Logged out successfully" }

# Verify session is inactive
curl http://localhost:1337/api/magic-sessionmanager/sessions \
  -H "Authorization: Bearer $JWT_TOKEN"
# Should fail - token no longer valid
```

### 6. Test Multi-Session

```bash
# Login first time
JWT_1=$(curl -s -X POST http://localhost:1337/api/auth/local \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@example.com","password":"SecurePass123!"}' \
  | jq -r '.jwt')

# Login second time (same user, different session)
JWT_2=$(curl -s -X POST http://localhost:1337/api/auth/local \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@example.com","password":"SecurePass123!"}' \
  | jq -r '.jwt')

# Check sessions - should have 2 active sessions
curl http://localhost:1337/api/magic-sessionmanager/sessions \
  -H "Authorization: Bearer $JWT_1" | jq '.meta.count'
# Output: 2
```

---

## 🐛 Troubleshooting

### Sessions Not Creating on Login

**Problem:** Users login but no session record appears.

**Solutions:**
1. Check Strapi logs for errors:
   ```bash
   npm run develop # Look for [magic-sessionmanager] error messages
   ```

2. Verify plugin is enabled:
   ```bash
   # Check config/plugins.ts includes magic-sessionmanager
   cat config/plugins.ts | grep magic-sessionmanager
   ```

3. Check if `api::session.session` collection exists:
   ```bash
   # Go to Admin → Content Manager → Session
   # Should see sessions being created
   ```

4. Verify middleware is mounted:
   ```bash
   # Check logs during login for:
   # [magic-sessionmanager] ✅ Login/Logout interceptor middleware mounted
   ```

### LastSeen Not Updating

**Problem:** Session's `lastActive` timestamp doesn't change on API requests.

**Solutions:**
1. Check rate limit setting:
   ```typescript
   // config/plugins.ts
   config: {
     lastSeenRateLimit: 5000 // Lower rate limit for testing
   }
   ```

2. Verify middleware is mounted:
   ```bash
   # Check logs for:
   # [magic-sessionmanager] ✅ LastSeen middleware mounted
   ```

3. Test with authenticated request:
   ```bash
   curl http://localhost:1337/api/users \
     -H "Authorization: Bearer $JWT_TOKEN"
   ```

4. Ensure sufficient time passed:
   ```bash
   # Wait longer than lastSeenRateLimit before next request
   sleep 35 # If limit is 30 seconds
   ```

### Admin Dashboard Shows 404

**Problem:** Clicking "Sessions" in sidebar shows 404.

**Solutions:**
1. Rebuild admin UI:
   ```bash
   npm run build --workspace=src/plugins/magic-sessionmanager
   ```

2. Clear browser cache:
   ```bash
   # Hard refresh in browser: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
   ```

3. Check browser console for errors:
   ```bash
   # Open DevTools: F12
   # Check Console tab for any JavaScript errors
   ```

4. Verify plugin build succeeded:
   ```bash
   # Check if dist/ folder was created
   ls -la src/plugins/magic-sessionmanager/dist/admin/
   ```

### License Shows as Invalid

**Problem:** "No valid license" message appears.

**Solutions:**
1. Check license activation:
   ```bash
   # Admin → Sessions → License tab
   # Click "Create License" button
   ```

2. Verify internet connectivity (for license validation):
   ```bash
   curl https://magic-link.schero.dev/api/license/verify
   ```

3. Check offline grace period:
   ```bash
   # License remains valid for 7 days without internet
   # If offline > 7 days, must reconnect to validate
   ```

4. View license status:
   ```bash
   # Admin → Sessions → License tab
   # Check "License Status" box for details
   ```

---

## 🛠️ Development

### Local Development

```bash
# Watch mode - rebuilds on file changes
npm run watch --workspace=src/plugins/magic-sessionmanager

# Link to local Strapi (for testing in another project)
npm run watch:link --workspace=src/plugins/magic-sessionmanager

# Verify plugin integrity
npm run verify --workspace=src/plugins/magic-sessionmanager
```

### Plugin Structure

```
magic-sessionmanager/
├── admin/                      # React admin UI
│   └── src/
│       ├── pages/              # Admin pages (Sessions, Settings, etc.)
│       ├── components/         # React components
│       ├── hooks/              # Custom React hooks
│       └── translations/       # i18n JSON files (de, en, es, fr, pt)
│
├── server/                     # Backend logic
│   └── src/
│       ├── bootstrap.js        # Plugin initialization & middleware
│       ├── register.js         # Plugin registration
│       ├── destroy.js          # Cleanup on plugin unload
│       ├── config/             # Configuration schema
│       ├── controllers/        # HTTP handlers
│       ├── services/           # Business logic
│       │   ├── session.js      # Session CRUD & tracking
│       │   ├── license-guard.js # License validation
│       │   ├── geolocation.js  # IP geolocation (Premium)
│       │   └── notifications.js # Email/webhook alerts
│       ├── routes/             # API route definitions
│       ├── middlewares/        # Express middleware
│       └── utils/              # Utility functions
│
├── package.json                # Dependencies & build config
└── README.md                   # This file
```

### Key Files

| File | Purpose |
|------|---------|
| `server/src/bootstrap.js` | Main entry point - initializes middleware & listeners |
| `server/src/services/session.js` | Session CRUD operations & business logic |
| `server/src/middlewares/last-seen.js` | Activity tracking middleware |
| `admin/src/pages/App.jsx` | Admin UI router & layout |
| `admin/src/components/SessionDetailModal.jsx` | Session details popup |

### Testing Locally

```bash
# Run test suite
npm test --workspace=src/plugins/magic-sessionmanager

# Generate test report
npm run test:coverage --workspace=src/plugins/magic-sessionmanager
```

---

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Support

For issues, questions, or feature requests:
- 📧 Email: support@magic-link.schero.dev
- 🐛 GitHub Issues: [Report a bug](https://github.com/Schero94/Magic-Sessionmanager/issues)
- 💬 Discussions: [Ask a question](https://github.com/Schero94/Magic-Sessionmanager/discussions)

---

## 🎯 Roadmap

- [ ] Redis session store for multi-instance deployments
- [ ] Session device fingerprinting
- [ ] Location-based step-up authentication
- [ ] Session analytics dashboards
- [ ] API rate limiting per session
- [ ] WebSocket support for real-time updates
- [ ] GraphQL API endpoints

---

**Built with ❤️ for Strapi v5**
