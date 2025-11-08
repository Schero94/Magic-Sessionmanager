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
✅ **DB-Backed** - Uses `api::session.session` content type  
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
Strapi Auth Service validates credentials
       ↓
✅ Auth Successful → Session Manager intercepts response
       ↓
Extract: User ID, IP, User Agent, JWT Token
       ↓
[PREMIUM] Check IP Geolocation:
  - Get country, city, ISP
  - Detect VPN/Proxy/Threat
  - Calculate security score
  - Apply geo-fencing rules
       ↓
[PREMIUM] Auto-blocking if:
  - Known threat IP
  - VPN detected (if configured)
  - Country blocked (if configured)
  - Security score < threshold
       ↓
Create api::session.session record:
  - userId, IP, userAgent
  - loginTime, token
  - geoData (if premium)
  - isActive = true
       ↓
[PREMIUM] Send notifications:
  - Email alerts (suspicious logins)
  - Webhook (Discord/Slack)
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
Update session:
  - isActive = false
  - logoutTime = now
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
Find sessions with: lastActive > inactivityTimeout
       ↓
Mark: isActive = false
       ↓
Log cleanup results
```

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
        "userAgent": "Mozilla/5.0...",
        "geoLocation": {
          "country": "Germany",
          "city": "Berlin",
          "country_code": "DE"
        }
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
| `GET` | `/magic-sessionmanager/admin/sessions` | Get all sessions (active + inactive) |
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

### Basic Config (Default)

```typescript
// src/config/plugins.ts
export default () => ({
  'magic-sessionmanager': {
    enabled: true,
    config: {
      // Rate limit for lastSeen updates (milliseconds)
      lastSeenRateLimit: 30000, // Default: 30 seconds
      
      // Session inactivity timeout (milliseconds)
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

## 🔒 Premium Features

### Requirements
- Valid license key from [https://magic-link.schero.dev](https://magic-link.schero.dev)
- License auto-validated via HTTPS on first login
- Offline grace period (continues working without internet for 7 days)

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

**Discord format:**

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

**Slack format:**

```
🔓 *New Login Detected*
• User: john@example.com
• Location: Berlin, Germany
• IP: 192.168.1.100
• Risk: Medium (VPN detected)
• Device: Chrome on Windows
• Time: 2024-01-15 10:30:00 UTC
```

---

## 💡 Use Cases

### Security Monitoring

**Multi-Device Login Detection**
```
User logs in from:
- Desktop (Germany) ✅
- Mobile (Germany) ✅
- Unknown device (Russia) ⚠️ → Email alert
```

**VPN/Proxy Detection**
```
Premium feature detects:
- VPN usage
- Proxy servers
- Tor exits
- Data center IPs
→ Optional auto-blocking
```

**Geo-Fencing**
```
Allow logins only from:
- Germany (DE)
- Austria (AT)
- Switzerland (CH)

Block all others → 403 Forbidden
```

### User Management

**Force Logout**
```
Admin can:
- Terminate specific session
- Logout user from all devices
- Monitor active sessions real-time
```

**Session Analytics**
```
Track:
- Peak usage times
- Average session duration
- Device/browser breakdown
- Geographic distribution
```

### Compliance

**Audit Trail**
```
Complete session history:
- Who logged in
- When & where (IP, location)
- Device & browser used
- Session duration
→ Export to CSV for compliance
```

---

## 🧪 Testing

### 1. Register/Login Test

```bash
# Register user
curl -X POST http://localhost:1337/api/auth/local/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "Test@123"
  }'

# Login
curl -X POST http://localhost:1337/api/auth/local \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "test@example.com",
    "password": "Test@123"
  }'

# Copy the JWT token
export JWT_TOKEN="eyJhbGciOiJIUzI1NiIs..."
```

### 2. Check Session Created

```bash
# View all active sessions (admin only)
curl http://localhost:1337/api/magic-sessionmanager/admin/sessions \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN"

# View your own sessions
curl http://localhost:1337/api/magic-sessionmanager/sessions \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### 3. Test Activity Tracking

```bash
# First request updates lastSeen
curl http://localhost:1337/api/users \
  -H "Authorization: Bearer $JWT_TOKEN"

# Wait 5 seconds, try again (should NOT update due to rate limit)
sleep 5
curl http://localhost:1337/api/users \
  -H "Authorization: Bearer $JWT_TOKEN"

# Wait 35 seconds, try again (should update now)
sleep 35
curl http://localhost:1337/api/users \
  -H "Authorization: Bearer $JWT_TOKEN"

# Check: lastActive timestamp should have changed
```

### 4. Test Logout

```bash
curl -X POST http://localhost:1337/api/auth/logout \
  -H "Authorization: Bearer $JWT_TOKEN"

# Response: { "message": "Logged out successfully" }

# Verify session is inactive
curl http://localhost:1337/api/magic-sessionmanager/sessions \
  -H "Authorization: Bearer $JWT_TOKEN"
# Should show isActive = false
```

### 5. Test Premium Features (with license)

```bash
# Login from different IP (use VPN/proxy)
# Check session for geolocation data
# Verify email alert sent (if configured)
# Check webhook notification (Discord/Slack)
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
   cat config/plugins.ts | grep magic-sessionmanager
   ```

3. Check if `api::session.session` collection exists:
   - Go to Admin → Content Manager
   - Look for "Session" collection

4. Verify middleware is mounted:
   ```bash
   # Check logs for:
   # [magic-sessionmanager] ✅ Login/Logout interceptor middleware mounted
   ```

### LastSeen Not Updating

**Problem:** Session's `lastActive` timestamp doesn't change on API requests.

**Solutions:**
1. Check rate limit setting:
   ```typescript
   config: {
     lastSeenRateLimit: 5000 // Lower for testing
   }
   ```

2. Wait longer than rate limit before next request

3. Verify middleware is mounted:
   ```bash
   # Check logs for:
   # [magic-sessionmanager] ✅ LastSeen middleware mounted
   ```

### License Shows as Invalid

**Problem:** "No valid license" message appears.

**Solutions:**
1. Activate license:
   - Admin → Sessions → License tab
   - Click "Create License" button

2. Check internet connection (for license validation)

3. Offline grace period:
   - License remains valid for 7 days without internet

4. View license status in Admin → Sessions → License

### Geolocation Not Working

**Problem:** No location data in sessions.

**Solutions:**
1. Activate license (Premium feature)
2. Enable in Settings → Geolocation
3. Check API rate limits (30,000/month free)
4. Test with public IP (localhost won't work)

---

## 🛠️ Development

### Local Development

```bash
# Watch mode - rebuilds on file changes
npm run watch

# Link to local Strapi
npm run watch:link

# Verify plugin integrity
npm run verify
```

### Plugin Structure

```
magic-sessionmanager/
├── admin/                      # React admin UI
│   └── src/
│       ├── pages/
│       │   ├── HomePage.jsx       # Main dashboard
│       │   ├── ActiveSessions.jsx # Active sessions tab
│       │   ├── Analytics.jsx      # Analytics tab
│       │   ├── Settings.jsx       # Settings tab
│       │   └── License.jsx        # License tab
│       ├── components/
│       │   ├── SessionDetailModal.jsx
│       │   ├── SessionInfoPanel.jsx
│       │   └── LicenseGuard.jsx
│       ├── hooks/
│       │   └── useLicense.js
│       └── utils/
│
├── server/                     # Backend logic
│   └── src/
│       ├── bootstrap.js        # Initialization & middleware
│       ├── services/
│       │   ├── session.js      # Session CRUD & tracking
│       │   ├── license-guard.js # License validation
│       │   ├── geolocation.js  # IP geolocation (Premium)
│       │   └── notifications.js # Email/webhook alerts
│       ├── controllers/
│       ├── routes/
│       ├── middlewares/
│       │   └── last-seen.js    # Activity tracking
│       └── utils/
│           └── getClientIp.js  # IP extraction
│
├── .github/workflows/          # CI/CD
│   ├── semantic-release.yml
│   └── test.yml
├── package.json
├── .releaserc.json
└── README.md
```

### Build & Release

```bash
# Build plugin
npm run build

# Package for NPM
npm run verify

# Release (automatic via GitHub Actions)
# Just use conventional commits:
git commit -m "feat: add new feature"    # → MINOR version
git commit -m "fix: fix bug"             # → PATCH version
git commit -m "feat!: breaking change"   # → MAJOR version
```

---

## 📦 NPM Release Process

This plugin uses **semantic-release** for automated versioning.

### Commit Message Format

```bash
# PATCH version (bug fix)
git commit -m "fix: correct session save issue"

# MINOR version (new feature)
git commit -m "feat: add geo-fencing support"

# MAJOR version (breaking change)
git commit -m "feat!: change session API response format"
```

### Automatic Release

GitHub Actions automatically:
- Analyzes commits
- Bumps version
- Updates CHANGELOG
- Publishes to NPM
- Creates GitHub release

---

## 🤝 Contributing

Contributions are welcome!

1. Fork: https://github.com/Schero94/Magic-Sessionmanager
2. Create branch: `git checkout -b feature/amazing`
3. Commit: `git commit -m "feat: add amazing feature"`
4. Push: `git push origin feature/amazing`
5. Open Pull Request

---

## 📚 Resources

- **NPM Package:** https://www.npmjs.com/package/strapi-plugin-magic-sessionmanager
- **GitHub:** https://github.com/Schero94/Magic-Sessionmanager
- **Issues:** https://github.com/Schero94/Magic-Sessionmanager/issues

---

## 📄 License

**MIT License** - Free for personal & commercial use

**Copyright (c) 2025 Schero D.**

See [LICENSE](./LICENSE) for full terms

---

## 🎯 Roadmap

- [ ] Redis session store for multi-instance deployments
- [ ] Session device fingerprinting
- [ ] Location-based step-up authentication
- [ ] WebSocket support for real-time updates
- [ ] API rate limiting per session
- [ ] GraphQL API endpoints
- [ ] 2FA integration
- [ ] Session history analytics

---

**Built with ❤️ for Strapi v5**
