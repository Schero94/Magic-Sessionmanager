# Local GeoIP Firewall Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace unreliable login-path remote GEOIP dependency with a local MaxMind GeoLite2 Country MMDB lookup path and testable firewall decisions.

**Architecture:** Keep the current `geolocation` service API, but add provider selection: `auto`, `local-mmdb`, `ipapi`, and `disabled`. A new pure `geo-firewall` utility decides whether a login is blocked from normalized geo data, so country firewall behavior can be unit-tested without a Strapi server.

**Tech Stack:** Node.js `node:test`, Strapi plugin services, `@maxmind/geoip2-node`, local `.mmdb` database configured by path.

---

### Task 1: Local MMDB Lookup Tests

**Files:**
- Test: `tests/geolocation-local-mmdb.test.js`
- Modify: `server/src/services/geolocation.js`

**Step 1: Write failing tests**
- Test that `geoIpProvider: "local-mmdb"` loads a configured MMDB file and returns `country_code`, `country`, `_status: "ok"`, and `_source: "local-mmdb"`.
- Test that a missing configured MMDB returns `_status: "error"` and does not call the remote provider.

**Step 2: Run failing test**
- Run: `npm test`
- Expected: fail because local provider support does not exist.

**Step 3: Implement minimal local provider**
- Add provider settings resolution.
- Dynamically open the MaxMind reader with `Reader.open(path, { watchForUpdates: true })`.
- Cache the reader per database path.
- Map `reader.country(ip)` to the existing geo result shape.

**Step 4: Run tests**
- Run: `npm test`
- Expected: pass for local provider behavior.

### Task 2: Firewall Decision Tests

**Files:**
- Create: `server/src/utils/geo-firewall.js`
- Test: `tests/geo-firewall.test.js`
- Modify: `server/src/bootstrap.js`

**Step 1: Write failing tests**
- Block when country is in `blockedCountries`.
- Block when allowlist is configured and the country is not listed.
- Allow private/local IP status.
- Respect `geoLookupFailureMode: "block"` on lookup failure.

**Step 2: Run failing test**
- Run: `npm test`
- Expected: fail because the utility does not exist.

**Step 3: Implement utility and wire login guard**
- Move the current decision logic into `evaluateGeoFirewall(settings, geoData)`.
- Use it from `mountPreLoginGeoGuard`.
- Preserve existing behavior: `blockSuspiciousSessions` still fails closed when lookup is unavailable unless explicitly configured otherwise.

**Step 4: Verify**
- Run: `npm test`
- Run: `npm run build && npm run verify && npm run verify:runtime`

### Task 3: Settings and Documentation

**Files:**
- Modify: `server/src/config/index.js`
- Modify: `server/src/controllers/settings.js`
- Modify: `server/src/utils/settings-loader.js`
- Modify: `README.md`
- Modify: `package.json`

**Step 1: Write/update tests**
- Extend settings tests to preserve/sanitize `geoIpProvider`, `geoIpDatabasePath`, and `geoLookupFailureMode`.

**Step 2: Implement settings**
- Defaults:
  - `geoIpProvider: "auto"`
  - `geoIpDatabasePath: process.env.MAGIC_SESSIONMANAGER_GEOIP_DATABASE || ""`
  - `geoLookupFailureMode: "auto"`
- Add dependency `@maxmind/geoip2-node`.

**Step 3: Document setup**
- Document MaxMind GeoLite2 Country as recommended provider.
- Document DB path env var and example Strapi plugin config.

**Step 4: Final verification**
- Run: `npm test`
- Run: `npm run build && npm run verify && npm run verify:runtime`
