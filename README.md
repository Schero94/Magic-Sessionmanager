# Magic Session Manager 🔐

**See who's signed in to your Strapi app - and control their sessions!**

Session Manager records every sign-in of your app's users (Users & Permissions) as a session and lets admins see, end and analyse them. Strapi admin accounts are not managed here.

Free and open under the MIT license. All features are available without a paid license or activation key.

[![NPM](https://img.shields.io/npm/v/strapi-plugin-magic-sessionmanager.svg)](https://www.npmjs.com/package/strapi-plugin-magic-sessionmanager)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Project site](https://schero94.github.io/Magic-Sessionmanager/)

---

## 📸 What It Looks Like

### Homepage Widget - Quick Stats at a Glance

![Online Users Widget](pics/widget.png)

**On your Strapi homepage, the "Online users" widget shows:**
- Online users, out of all registered users. A user is online when at least one of their sessions is active.
- Active sessions (open and used within the inactivity timeout)
- Idle sessions (open, but unused for longer than the inactivity timeout)
- Blocked users
- A link to open Session Manager

---

### Main Dashboard - See All Active Sessions

![Dashboard](pics/dashboard.png)

**The Sessions page shows:**
- The state of every session: **Active**, **Idle** or **Ended**. An ended session also shows its end reason: logged out, timed out, expired, ended manually, user blocked, or reason not recorded.
- Who signed in, when they signed in and when they were last active
- The device, browser and operating system, and the IP address
- Search by user, email, IP or device; filter by status and, for ended sessions, by end reason
- **End session** (the user is signed out on that device, the record stays) and **Delete record** (the record is removed from history, statistics and exports; an open session also ends). Both ask for confirmation.
- Export of the filtered list as CSV or JSON, including an "End reason" column and never any tokens

---

### Session Details Modal

![Session Modal](pics/dashboardsessionmodal.png)

**Click any session to see its details:**
- Why it is in its current state, in one sentence
- User, sign-in time, last activity, end time and end reason
- Device type, browser, operating system and IP address
- Stored location and the security score (0-100)
- **Look up location** for sessions without a stored location. The lookup runs only when you click it, because it can send the IP address to ipapi.co.
- Technical details: record ID and raw user agent

---

### Content Manager Integration

![Session Info Panel](pics/sessioninfopanel.png)

**When you edit a user in the Content Manager, the "Sessions" panel shows:**
- Whether the user is **Online** or **Not online**, and how many open sessions they have
- **End all sessions**: signs the user out on every device. They can sign in again.
- **Block user** / **Unblock user**: a blocked user cannot sign in, and all open sessions end. Unblocking allows sign-in again but does not restore ended sessions.
- Their open sessions, and a link to all of their sessions on the Sessions page

---

### Settings Page

![Settings 1](pics/settings1.png)

**Settings › Session Manager has three pages:** Configuration, Analytics and License.

**Configuration has five tabs:**
- **Sessions:** inactivity timeout, maximum session age, token check, idle check
- **Login protection:** temporary IP lockout, trusted proxy headers, rejecting suspicious sign-ins, country rules
- **Location data:** IP location lookup, security scoring, provider and MaxMind database
- **Alerts:** security emails to users and team notifications to Discord or Slack
- **Data and retention:** how long ended sessions are kept, and deleting all ended sessions

![Settings 2](pics/settings2.png)

**Also in Configuration:**
- A token encryption key generator (Sessions › Advanced)
- Country rules: allow only listed countries, or reject listed countries
- Rejection of sign-ins from VPN, proxy or known threat addresses
- Settings are saved in the database; other server processes apply changes within 30 seconds

**Analytics** shows sessions over time and by device and browser. **License** shows whether an optional license key is stored and valid; all features work without one.

---

## ✨ What This Plugin Does

### Simple Version

**When users sign in:**
- The plugin records a session: who signed in, when, from which device and from where
- You see it on the Sessions page (see screenshot above)

**A session is in one of three states:**
- **Active:** open and used within the inactivity timeout
- **Idle:** open, but unused for longer than the inactivity timeout. It ends on its next request or at the next idle check. A token refresh makes it active again.
- **Ended:** it can no longer be used, and the user has to sign in again on that device. The end reason says why: logged out, timed out, expired (maximum session age reached), ended manually, user blocked, or reason not recorded.

**Three actions, three meanings:**
- **End** a session: it stops working, the record stays in the history
- **Delete** a record: the history entry is removed; if the session is still open, it also ends. Its token stays revoked.
- **Block** a user: the user cannot sign in, and all open sessions end

**While users are active:**
- The plugin updates "Last active" with a short delay, to save database writes

---

## 🚀 Quick Install

### Step 1: Install

```bash
npm install strapi-plugin-magic-sessionmanager
```

### Step 2: Enable Plugin

Add this to `config/plugins.ts`:

```typescript
export default () => ({
  'magic-sessionmanager': {
    enabled: true,
  },
});
```

### Step 3: Rebuild & Start

```bash
npm run build
npm run develop
```

### Step 4: Open Dashboard

1. Go to Strapi Admin: `http://localhost:1337/admin`
2. Look in the left sidebar for **"Session Manager"**
3. Click it!
4. You'll see the **Sessions** page (like the screenshot above)

**That's it! You're done!**

---

## 🔐 Security Features (Optional)

### Encryption Key (Recommended)

Session Manager encrypts the tokens it stores with the `SESSION_ENCRYPTION_KEY` environment variable. It is not needed in Strapi's refresh-token mode (`jwtManagement: 'refresh'`). Generate a key:

**In the admin panel:**
1. Go to **Settings › Session Manager › Configuration**, tab **Sessions**
2. Open **Advanced** and find the token encryption key generator
3. Generate a key. It stays hidden until you reveal it, and nothing is saved in Strapi.
4. Click **"Copy for .env"**
5. Paste it into your `.env` file
6. Restart Strapi

**Or generate manually:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then add to `.env`:
```
SESSION_ENCRYPTION_KEY=your-key-here
```

**Why?** If someone reads your database, they cannot reuse the stored tokens.

---

## 🎯 Main Features Explained Simply

### 1. See Who's Logged In

**Sessions page:**
- Shows every recorded session with its state badge: Active, Idle or Ended
- Ended sessions show their end reason under the badge
- The four cards at the top (Active, Idle, Ended, All) filter the list
- Click a row to see details

### 2. Force Logout Anyone

**Need to sign someone out?**
1. Find their session
2. Click **"End session"** and confirm
3. The session ends with the reason "Ended manually" and the record stays in the history. In Strapi's refresh-token mode the Strapi session is revoked first. The behavior depends on the mode below.

To sign a user out everywhere, use **End all sessions** in the user's Sessions panel in the Content Manager. To also stop new sign-ins, use **Block user**.

### 3. Session Details

**Click any session to see:**
- When they signed in
- When they were last active, and when and why the session ended
- What browser and device they use
- Their IP address
- Location (stored at sign-in, or looked up when you click **Look up location**)

### 4. Multiple Devices

**Users can login from:**
- Desktop computer
- Phone
- Tablet
- All at the same time!

Each sign-in is a separate session. You can see them all and end each one individually.

### 5. Auto-Cleanup

**Idle sessions end automatically, and old history is deleted:**
- A session unused for longer than the inactivity timeout (15 minutes by default) becomes idle
- The **idle check** runs on a schedule (every 30 minutes by default, and once at server start) and ends idle sessions as "Timed out". It deletes nothing.
- **History retention** deletes the records of ended sessions after 90 days by default. Open sessions are never deleted by retention.
- **Delete ended sessions** (Configuration › Data and retention) removes the records of all ended sessions of all users at once. Open sessions, including idle ones, are not affected.

---

## 🔒 Session management modes

Magic Sessionmanager supports Strapi Users & Permissions end-user sessions in both the native refresh mode and the existing `legacy-support` mode.

### Native Users & Permissions sessions

Set `jwtManagement` to `refresh` in the host application's Users & Permissions configuration to use Strapi's native session manager:

```typescript
'users-permissions': {
  config: {
    jwtManagement: 'refresh',
  },
}
```

In this mode, Strapi issues, rotates and revokes native sessions. Magic Sessionmanager uses that state for end-user sessions while keeping its metadata and session history, such as device, IP, GeoIP and security details. It does not issue or rotate a second token family. Rows created natively without a Magic metadata record can still appear with a `native_` ID; the admin marks them as "Strapi session". Their device, IP and location were not recorded and are shown as "—" ("Not recorded").

The existing Magic endpoints keep their paths, methods, permissions and response envelopes. The plugin does not change the host application's authentication configuration or migrate existing session records. Set `jwtManagement: 'refresh'` in the host application to opt into native session management. Its default Content API permission setup targets only the Authenticated role and never adds these actions to Public. If an administrator saves the Authenticated role before the first protected Magic request, the plugin preserves that role's permission choices. Strapi administrator-account sessions are not managed by this plugin.

### Existing `legacy-support` mode

When Users & Permissions uses `jwtManagement: 'legacy-support'`, Magic Sessionmanager keeps its existing plugin-owned session behavior. It does not switch the host to refresh mode or migrate legacy session records. Existing Magic endpoints remain available in either mode.

---

## 🌍 Security Features

### IP Geolocation

**See where users login from:**
- Country (with flag! 🇩🇪🇺🇸🇬🇧)
- City
- ISP Provider
- Coordinates (for map)

IP geolocation is enabled by default and the default provider is `auto`.
When no local database is available, `auto` sends the session IP address to
ipapi.co for a lookup. If a local lookup fails, `auto` can also send the IP
address to ipapi.co. With `geoLookupFailureMode: 'block'`, a failed local
lookup does not fall back to ipapi.co. This setting does not prevent the
remote lookup when no local database is available.

To avoid remote IP lookups, choose `local-mmdb`, which uses a local database
and does not fall back to ipapi.co. Choose `disabled` for no GeoIP lookup,
or set `enableGeolocation: false` for no GeoIP lookup. These choices affect
geolocation and can affect geofencing decisions when a lookup is unavailable.

The MaxMind database download is a separate authenticated network request;
the MaxMind database download does not send end-user session IP addresses.
Local lookups use the downloaded database without contacting MaxMind.

### Local GeoIP Firewall (Recommended)

For country rules, suspicious-sign-in checks and city-level session display, use a local MaxMind
GeoLite2 City database. This avoids remote API timeouts and rate limits in the
login path while still giving the admin UI city, region, timezone and
coordinates. Existing GeoLite2 Country databases remain supported as a
country-only fallback.

1. Create a free MaxMind account and download `GeoLite2-City.mmdb`:
   https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/
2. Store the file on your Strapi server, for example:
   `/var/lib/strapi/GeoLite2-City.mmdb`
3. Configure the plugin:

```bash
MAGIC_SESSIONMANAGER_GEOIP_DATABASE=/var/lib/strapi/GeoLite2-City.mmdb
MAXMIND_EDITION_ID=GeoLite2-City
MAXMIND_ACCOUNT_ID=your-account-id
MAXMIND_LICENSE_KEY=your-license-key
```

You can also manage this from the Strapi admin UI. Open
**Settings › Session Manager › Configuration**, tab **Location data**, choose
the provider **Local database** (`local-mmdb`), enter the MaxMind account ID and
license key, then use **Update database**. Environment variables take
precedence over stored credentials.
The plugin stores the credentials in the Strapi plugin store and never returns
the license key to the browser after saving it.

Download or update the database. The CLI updater needs your MaxMind
credentials via environment variables (the in-admin updater stores them in the
Strapi plugin store instead):

```bash
export MAXMIND_ACCOUNT_ID=your_account_id
export MAXMIND_LICENSE_KEY=your_license_key
export MAXMIND_EDITION_ID=GeoLite2-City
npm run geoip:update
```

When installed as a package in a Strapi project, run the packaged binary:

```bash
npx strapi-magic-sessionmanager-geoip
```

The updater checks MaxMind's `Last-Modified` header first and skips the download
when the local metadata is current. Use `npm run geoip:update -- --force` in the
plugin repo or `npx strapi-magic-sessionmanager-geoip --force` in an installed
Strapi project to force a refresh. Schedule it weekly or twice weekly with
cron/systemd. MaxMind requires GeoLite databases to stay up to date and
currently limits GeoLite users to 30 database downloads per day.

```typescript
// config/plugins.ts
export default () => ({
  'magic-sessionmanager': {
    enabled: true,
    config: {
      geoIpProvider: 'local-mmdb',
      geoIpDatabasePath: process.env.MAGIC_SESSIONMANAGER_GEOIP_DATABASE,
      // "auto": fail closed for suspicious-session blocking, fail open for plain geofencing
      // "block": fail closed whenever GEOIP lookup is unavailable
      // "allow": fail open whenever GEOIP lookup is unavailable
      geoLookupFailureMode: 'block',
      enableGeofencing: true,
      allowedCountries: ['DE', 'AT', 'CH'],
    },
  },
});
```

Provider options:
- `local-mmdb`: local MaxMind-compatible database only
- `auto`: use a local database when available, with remote fallback as described above
- `ipapi`: send the IP address to ipapi.co for a remote lookup
- `disabled`: no GEOIP lookup

Local City and Country databases both support country firewall rules. City
databases additionally populate city, region, timezone, coordinates and postal
data for the admin UI. VPN/proxy/threat detection still requires a provider
that supplies those risk signals; free GeoLite databases do not reliably
identify VPNs or proxies.

### Threat Detection

**With IP location lookup on, each sign-in IP address is checked for:**
- VPN
- Proxy
- Known threat
- Security score (0-100, higher is safer). The local database always gives 100, and a failed lookup gives 50.

### Auto-Blocking

**Login protection** (Configuration › Login protection) checks **new sign-ins only**. Existing sessions are not affected, and refused sign-ins are not recorded.

- **Temporary IP lockout:** after too many failed sign-ins from one IP address within 15 minutes (5 by default, 0 turns it off), that address is refused for 15 minutes (429 with `Retry-After`). User accounts are not blocked. Failed sign-ins are counted per server process.
- **Reject suspicious sign-ins:** refuses sign-ins from VPN, proxy or known threat addresses and, with security scoring on, scores below 50 (403).
- **Country rules:** allow only listed countries, or reject listed countries (403).
- If the location cannot be determined, the configured failure mode decides whether the sign-in is allowed or refused with "Login temporarily unavailable".

Suspicious-sign-in checks, country rules and alerts need IP location lookup. Blocking a user account is a separate action (**Block user**).

### Notifications

**Configuration › Alerts** has two kinds of alerts. Both are sent only when location data is available for the sign-in:
- **Security emails to users:** sent to the end user's own email address, not to administrators, for a suspicious sign-in, a sign-in from a new country, or a VPN or proxy.
- **Team notifications:** messages to your **Discord or Slack** channel for every sign-in, as suspicious, new country or success. Only `https://discord.com`, `https://discordapp.com` and `https://hooks.slack.com` webhook URLs are accepted; other URLs are not saved.

---

## 📧 Email Alerts Setup

The Session Manager uses **Strapi's Email Plugin** to send notifications. You need to configure an email provider first.

### Step 1: Install Email Provider

Choose one of these providers:

**Option A: Nodemailer (Recommended)**
```bash
npm install @strapi/provider-email-nodemailer
```

**Option B: SendGrid**
```bash
npm install @strapi/provider-email-sendgrid
```

**Option C: Mailgun**
```bash
npm install @strapi/provider-email-mailgun
```

### Step 2: Configure Email Plugin

Add to `config/plugins.ts`:

```typescript
export default () => ({
  // Email configuration
  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || 587,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      },
      settings: {
        defaultFrom: process.env.SMTP_DEFAULT_FROM || 'noreply@yourapp.com',
        defaultReplyTo: process.env.SMTP_DEFAULT_REPLY_TO || 'support@yourapp.com',
      },
    },
  },
  
  // Session Manager configuration
  'magic-sessionmanager': {
    enabled: true,
  },
});
```

### Step 3: Add Environment Variables

Add to your `.env` file:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_DEFAULT_FROM=noreply@yourapp.com
SMTP_DEFAULT_REPLY_TO=support@yourapp.com
```

**For Gmail:**
- Use an [App Password](https://support.google.com/accounts/answer/185833), not your regular password!

### Step 4: Enable in Admin Panel

1. Go to **Settings › Session Manager › Configuration**, tab **Alerts**
2. Find **"Security emails to users"**. It needs IP location lookup (tab **Location data**).
3. Turn on **"Send security emails"**
4. Edit the email templates (optional). As soon as any template has content, only your stored templates are used, so fill in all three or none.
5. Click **Save**

### Step 5: Test It

Trigger a suspicious sign-in (for example through a VPN, with a provider that detects VPNs) and check whether the email arrives.

**Troubleshooting:**
- Check Strapi logs for email errors
- Verify SMTP credentials are correct
- Test SMTP connection with a tool like [smtp-tester](https://www.npmjs.com/package/smtp-tester)

---

## 📋 Content-API Endpoints (For Frontend/Apps)

All Content-API endpoints require a valid JWT token in the `Authorization` header.
Users can only access their **own** sessions.

### Get My Sessions

Returns all sessions for the authenticated user.

```bash
GET /api/magic-sessionmanager/my-sessions
Authorization: Bearer <JWT>
```

**Response:**
```json
{
  "data": [
    {
      "id": "abc123xyz",
      "documentId": "abc123xyz",
      "sessionId": "sess_m5k2h_8a3b1c2d_f9e8d7c6",
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36...",
      "loginTime": "2026-01-02T10:30:00.000Z",
      "lastActive": "2026-01-02T13:45:00.000Z",
      "logoutTime": null,
      "isActive": true,
      "deviceType": "desktop",
      "browserName": "Chrome 143",
      "osName": "macOS 10.15.7",
      "geoLocation": null,
      "securityScore": null,
      "isCurrentSession": true,
      "isTrulyActive": true,
      "minutesSinceActive": 2
    },
    {
      "id": "def456uvw",
      "documentId": "def456uvw",
      "sessionId": "sess_m5k1g_7b2a0c1d_e8d7c6b5",
      "ipAddress": "10.0.0.50",
      "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)...",
      "loginTime": "2026-01-01T08:15:00.000Z",
      "lastActive": "2026-01-01T12:00:00.000Z",
      "logoutTime": null,
      "isActive": true,
      "deviceType": "mobile",
      "browserName": "Safari",
      "osName": "iOS 17",
      "geoLocation": null,
      "securityScore": null,
      "isCurrentSession": false,
      "isTrulyActive": false,
      "minutesSinceActive": 1545
    }
  ],
  "meta": {
    "count": 2,
    "active": 1
  }
}
```

### Get Current Session

Returns only the session associated with the current JWT token.

```bash
GET /api/magic-sessionmanager/current-session
Authorization: Bearer <JWT>
```

**Response:**
```json
{
  "data": {
    "id": "abc123xyz",
    "documentId": "abc123xyz",
    "sessionId": "sess_m5k2h_8a3b1c2d_f9e8d7c6",
    "ipAddress": "192.168.1.100",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36...",
    "loginTime": "2026-01-02T10:30:00.000Z",
    "lastActive": "2026-01-02T13:45:00.000Z",
    "logoutTime": null,
    "isActive": true,
    "deviceType": "desktop",
    "browserName": "Chrome 143",
    "osName": "macOS 10.15.7",
    "geoLocation": null,
    "securityScore": null,
    "isCurrentSession": true,
    "isTrulyActive": true,
    "minutesSinceActive": 2
  }
}
```

### Logout (Current Session)

Ends only the current session (end reason `logout`).

```bash
POST /api/magic-sessionmanager/logout
Authorization: Bearer <JWT>
```

**Response:**
```json
{
  "message": "Logged out successfully"
}
```

### Logout All Devices

Ends all sessions of the authenticated user (signs out everywhere, end reason `logout`).

```bash
POST /api/magic-sessionmanager/logout-all
Authorization: Bearer <JWT>
```

**Response:**
```json
{
  "message": "Logged out from all devices successfully"
}
```

### Terminate Specific Session

Ends a specific session of the authenticated user (not the current one), with the end reason `manual`. Useful for "Sign out other devices".
Use the `id` / `documentId` value from the session response. The separate `sessionId` field is a tracking identifier stored on the session record.

For a native-only row, use its `native_` value from `id`. Native-only rows may not have a `documentId` or Magic metadata.

```bash
DELETE /api/magic-sessionmanager/my-sessions/:documentId
Authorization: Bearer <JWT>
```

**Response:**
```json
{
  "message": "Session abc123xyz terminated successfully",
  "success": true
}
```

**Error (trying to terminate current session):**
```json
{
  "error": {
    "status": 400,
    "message": "Cannot terminate current session. Use /logout instead."
  }
}
```

---

## 📋 Admin-API Endpoints (For Admin Panel)

These endpoints require admin authentication and the plugin's admin access permission. They manage end-user (Users & Permissions) sessions only.

### Get All Sessions

```bash
GET /magic-sessionmanager/sessions
```

### Get Active Sessions Only

```bash
GET /magic-sessionmanager/sessions/active
```

### Force Terminate Session

```bash
POST /magic-sessionmanager/sessions/:sessionId/terminate
```

Ends one session (**End session** in the admin). The session gets the end reason `manual`; in Strapi's refresh-token mode the Strapi session is revoked first. The record stays in the history. The user's next request with that token gets 401.

### Delete Session Record

```bash
DELETE /magic-sessionmanager/sessions/:sessionId
```

Deletes one session record (**Delete record** in the admin). The record is removed from history, statistics and exports, and its token stays revoked. If the session is still open, it also ends.

### Terminate All User Sessions

```bash
POST /magic-sessionmanager/user/:userId/terminate-all
```

Ends all open sessions of one user (**End all sessions** in the admin) with the end reason `manual`. The user can sign in again unless the account is blocked.

### Block/Unblock User

```bash
POST /magic-sessionmanager/user/:userId/toggle-block
```

Sets or toggles the Users & Permissions `blocked` flag of one user (**Block user** / **Unblock user** in the admin). Blocking also ends all open sessions of the user with the end reason `blocked`; the user cannot sign in until unblocked. Unblocking allows sign-in again but does not restore ended sessions.

- **Recommended:** send JSON `{ "blocked": true }` to block or `{ "blocked": false }` to unblock. This sets the state, so it is safe to retry, and it is what the admin UI sends.
- **Without a body** (or without a `blocked` field) the request still toggles the current state, as in earlier versions. This form is deprecated: a retry after a failed or lost response can reverse the intended state.
- A `blocked` value that is present but not a boolean returns 400 before anything changes.
- The response contains `blocked` (the new state) and the additive field `mode`: `explicit` when `blocked` was sent, `toggle` for the bodyless form. Existing fields are unchanged.

If ending the sessions fails, the response is 500 and the user can stay blocked while some sessions remain open; retry the same `{ "blocked": true }` request to resume. Different concurrent block and unblock requests are not serialized by this endpoint.

### Clean Inactive Sessions

```bash
POST /magic-sessionmanager/sessions/clean-inactive
```

Deletes the records of all ended sessions of all users (**Delete ended sessions** in the admin). Open sessions, including idle ones, are not affected, and the tokens of deleted sessions stay revoked. This does not run the idle check.

---

## ⚙️ Settings You Can Change

**In `config/plugins.ts`:**

```typescript
'magic-sessionmanager': {
  config: {
    // How often to update "last seen" (in milliseconds)
    lastSeenRateLimit: 30000,  // Default: 30 seconds
    
    // How long a session may stay unused before it becomes idle and then ends (in milliseconds)
    inactivityTimeout: 900000,  // Default: 15 minutes
  },
}
```

**In the admin panel (Settings › Session Manager › Configuration):**
- **Sessions:** inactivity timeout, maximum session age, token check (strict or relaxed), idle check interval, encryption key generator
- **Login protection:** temporary IP lockout, trust proxy headers, reject suspicious sign-ins, country rules. These affect new sign-ins only.
- **Location data:** IP location lookup, security scoring, provider, MaxMind credentials and database updates
- **Alerts:** security emails to users, team notifications (Discord or Slack webhook URLs only)
- **Data and retention:** how long ended sessions are kept, and deleting all ended sessions

Settings saved in the admin are stored in the database. Other server processes apply them within 30 seconds.

---

## 🐛 Common Problems & Fixes

### I don't see the Sessions menu

**Fix:**
1. Make sure plugin is in `config/plugins.ts`
2. Run `npm run build`
3. Restart Strapi
4. Refresh browser (Cmd+Shift+R)

### Sessions not being created

**Fix:**
1. Check Strapi logs for errors
2. Make sure users are logging in (not already logged in)
3. Check database is working

### 401 or 403 errors

**Fix:**
- 401 = Not logged in (need to login as admin)
- 403 = Not allowed (check you're admin, not regular user)

### Database table "sessions" already exists

**Fix:**
- This plugin uses `magic_sessions` table (not `sessions`)
- If you see this error, another plugin is using that name
- Our plugin automatically uses the correct name

---

## 💡 When To Use This Plugin

**Perfect for:**
- Multi-tenant apps (see which tenant users are online)
- E-commerce (track customer sessions)
- Collaboration tools (show who's currently working)
- Security-critical apps (end sessions and block compromised accounts)
- Compliance requirements (session audit logs)

**Not needed if:**
- Single-user app
- No need to see who's logged in
- No security requirements

---

## 🔧 How To Test It

### Quick Manual Test

1. **Sign in to your app as an end user** (Users & Permissions, for example through your frontend). Strapi admin sign-ins are not recorded.
2. **In the Strapi admin, open Session Manager**
3. **You should see the session as Active**
4. **Click "End session" on it and confirm**
5. **Use the app with the same token → the request is rejected with 401, and the session shows Ended · Ended manually**

### With Postman

**1. Login:**
```
POST http://localhost:1337/api/auth/local
Body: { "identifier": "user@test.com", "password": "pass123" }
```

**2. Check session created:**
```
GET http://localhost:1337/magic-sessionmanager/sessions
```

**3. Logout:**
```
POST http://localhost:1337/api/auth/logout
Authorization: Bearer YOUR_JWT_TOKEN
```

**Done!**

---

## 📦 What Gets Installed

When you install this plugin, you get:

- ✅ Sessions page with every recorded session
- ✅ Session tracking (automatic)
- ✅ End session, End all sessions, Delete record, Block user
- ✅ Activity monitoring and Analytics
- ✅ Token encryption
- ✅ Multi-device support

**All features are included for free:**
- ✅ IP location lookup
- ✅ Threat detection
- ✅ Login protection (temporary IP lockout, suspicious sign-ins, country rules)
- ✅ Security emails to users and Discord or Slack team notifications

---

## 🙋 FAQ

**Q: Do I need to change my Strapi code?**  
A: No! Just install and enable the plugin.

**Q: Will this break my existing logins?**  
A: Existing sign-in flows keep working. Login protection checks new sign-ins only: the temporary IP lockout is on by default (5 failed sign-ins from one IP address within 15 minutes), while suspicious-sign-in and country rules are off until you turn them on.

**Q: Can users see each other's sessions?**  
A: No. Only admins can see all sessions. Users only see their own.

**Q: What if I uninstall the plugin?**  
A: Sessions will stop being tracked. Everything else works normally.

**Q: Does it slow down my app?**  
A: No! It has smart rate-limiting to prevent database spam.

**Q: Can I customize the dashboard?**  
A: Not yet, but it's planned for future versions!

---

## 📚 Resources

- **NPM:** https://www.npmjs.com/package/strapi-plugin-magic-sessionmanager
- **GitHub:** https://github.com/Schero94/Magic-Sessionmanager
- **Report Bugs:** https://github.com/Schero94/Magic-Sessionmanager/issues

---

## 📄 License

**MIT License** - Free to use for personal and commercial projects!

**Copyright © 2025 Schero D.**

### Optional license-key activation

**Settings › Session Manager › License** shows whether an optional license key is stored and whether it is valid. It is read-only. The key is only used for install tracking and support context; it does not unlock or restrict any plugin feature. All features work without a key.

See [LICENSE](./LICENSE) for full terms.

---

## 🌐 Supported Languages

The admin interface is available in **5 languages:**

- 🇬🇧 **English** - Default
- 🇩🇪 **Deutsch** - German
- 🇪🇸 **Español** - Spanish
- 🇫🇷 **Français** - French
- 🇵🇹 **Português** - Portuguese

Language automatically follows your Strapi admin interface setting.

---

**Made for Strapi v5**
