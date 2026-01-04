## [4.2.14](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.13...v4.2.14) (2026-01-04)


### Bug Fixes

* exclude admin panel routes from session validation ([82e37b2](https://github.com/Schero94/Magic-Sessionmanager/commit/82e37b2508ff3d8aebc2230902ce4f739d8a4b6b))

## [4.2.13](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.12...v4.2.13) (2026-01-03)


### Bug Fixes

* optimize session lookups and add geolocation on-demand ([bfaa693](https://github.com/Schero94/Magic-Sessionmanager/commit/bfaa6930678e4047df0a6b3ff6f822ac1aa212dd))

## [4.2.12](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.11...v4.2.12) (2026-01-02)


### Bug Fixes

* store geoLocation and device info on session creation ([64ca261](https://github.com/Schero94/Magic-Sessionmanager/commit/64ca26112fa459e11d833770d01cbceee868151f))

## [4.2.11](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.10...v4.2.11) (2026-01-02)


### Bug Fixes

* use tokenHash for O(1) session lookup, add UA parser for device info ([34787ae](https://github.com/Schero94/Magic-Sessionmanager/commit/34787aeb228ea3091bd1f7ecb4ab8a6ab3cdcecf))

## [4.2.10](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.9...v4.2.10) (2026-01-01)


### Performance Improvements

* add database index on tokenHash for true O(1) lookup ([f923b06](https://github.com/Schero94/Magic-Sessionmanager/commit/f923b0632823903d1a45b5b306403b44de3b4627))

## [4.2.9](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.8...v4.2.9) (2026-01-01)


### Performance Improvements

* O(1) session lookup via tokenHash instead of O(n) decrypt loop ([1d68fa0](https://github.com/Schero94/Magic-Sessionmanager/commit/1d68fa0b29e89945eeabf57e54b2c438cb6bda76))

## [4.2.8](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.7...v4.2.8) (2026-01-01)


### Bug Fixes

* update session activity on ALL requests with valid JWT ([702d3ad](https://github.com/Schero94/Magic-Sessionmanager/commit/702d3ad3442520cf9a1865d8b6164ef87d1c73b6))

## [4.2.7](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.6...v4.2.7) (2025-12-28)


### Bug Fixes

* bump version to 4.2.7 ([c6c86a6](https://github.com/Schero94/Magic-Sessionmanager/commit/c6c86a620c1e99b895de6de8ffe221751ad489a6))
* validate specific JWT session on each request, add enduser session management endpoints ([c07a5a1](https://github.com/Schero94/Magic-Sessionmanager/commit/c07a5a149f91140c189eb16498395fd5d8905105))

## [4.2.6](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.5...v4.2.6) (2025-12-14)


### Bug Fixes

* clean up README formatting ([d2082bd](https://github.com/Schero94/Magic-Sessionmanager/commit/d2082bd5387f644970eae83b8cb2b8aa938df2dd))

## [4.2.5](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.4...v4.2.5) (2025-12-14)


### Bug Fixes

* remove source folders from npm package ([d64f279](https://github.com/Schero94/Magic-Sessionmanager/commit/d64f279015fe1ada50e580e6a02eca2ed1b3b227))

## [4.2.4](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.3...v4.2.4) (2025-12-14)


### Bug Fixes

* enable npm provenance with OIDC trusted publishing ([f66106c](https://github.com/Schero94/Magic-Sessionmanager/commit/f66106ccdb716fd8be25d462c1b25bc51d4ba3a8))

## [4.2.3](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.2...v4.2.3) (2025-12-14)


### Bug Fixes

* update release workflow for new npm token requirements ([88b70ff](https://github.com/Schero94/Magic-Sessionmanager/commit/88b70ffd9e697085ce99f6e89ea971b78caa1c92))

## [4.2.2](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.1...v4.2.2) (2025-12-14)


### Bug Fixes

* add debug mode documentation to README ([f675180](https://github.com/Schero94/Magic-Sessionmanager/commit/f675180890dffb40c933e80917d9806da07b6d8d))

## [4.2.1](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.2.0...v4.2.1) (2025-12-14)


### Bug Fixes

* add debug mode for plugin logging ([1eff03a](https://github.com/Schero94/Magic-Sessionmanager/commit/1eff03af93a1905d52044467d697d965d564860e))

# [4.2.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.1.0...v4.2.0) (2025-12-08)


### Features

* enhance pull request template with session management specific sections and security checklist ([bcf9782](https://github.com/Schero94/Magic-Sessionmanager/commit/bcf9782068808d955dbcced2801d3e6eecbe9f31))

# [4.1.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.0.3...v4.1.0) (2025-12-08)


### Features

* enhance GitHub issue templates with session management specific fields and feature request template ([78188de](https://github.com/Schero94/Magic-Sessionmanager/commit/78188dee1711ecd82ce548faceb34917bd907246))

## [4.0.3](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.0.2...v4.0.3) (2025-12-08)


### Bug Fixes

* update CI workflow to use Node.js 22 for compatibility with dependencies ([113e02e](https://github.com/Schero94/Magic-Sessionmanager/commit/113e02e1991bbd296eed2a30dfb4ee42e6dc4718))

## [4.0.2](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.0.1...v4.0.2) (2025-12-08)


### Bug Fixes

* add GitHub templates for better open-source collaboration ([4322fd4](https://github.com/Schero94/Magic-Sessionmanager/commit/4322fd4f69210320921a1a1aee1459da4fe29a0c))

## [4.0.1](https://github.com/Schero94/Magic-Sessionmanager/compare/v4.0.0...v4.0.1) (2025-12-05)


### Bug Fixes

* replace emojis with text prefixes for better compatibility ([a8b319e](https://github.com/Schero94/Magic-Sessionmanager/commit/a8b319e0b0cf8b71a4da4aafa454adaf9e60203d))

# [4.0.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.7.0...v4.0.0) (2025-12-04)


### Bug Fixes

* migrate to Strapi v5 Document Service API ([6ab18d0](https://github.com/Schero94/Magic-Sessionmanager/commit/6ab18d0577ed5733d6737b79b28b53ef00ba81a5))
* Strapi v5 compliance - use documentId instead of id ([08a061e](https://github.com/Schero94/Magic-Sessionmanager/commit/08a061ec5348c423e2999c1c15d0b2f5ec7e1682))


### BREAKING CHANGES

* Complete migration from Entity Service to Document Service API

- Migrate all strapi.entityService calls to strapi.documents()
- Fix Deep Filtering: Use { user: { documentId: userId } } syntax
- Remove all emojis from logs (54 instances)
- Replace with text prefixes: [SUCCESS], [ERROR], [WARNING]
- Remove unused Textarea imports (8 files)
- Add UID constants for better maintainability

This is a critical Strapi v5 compatibility update.
All session management now uses the modern Document Service API.

# [3.7.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.6.0...v3.7.0) (2025-11-10)


### Features

* Add Spanish, French, and Portuguese translations (5 languages total) ([d8bd41d](https://github.com/Schero94/Magic-Sessionmanager/commit/d8bd41d24101f932877cc8edcf1d00c2379ec68a))

# [3.6.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.5.0...v3.6.0) (2025-11-09)


### Features

* Add license protection clause matching MagicMark ([0bc7508](https://github.com/Schero94/Magic-Sessionmanager/commit/0bc7508e5cd0c41286faa681dbe6987b68292539))

# [3.5.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.4.0...v3.5.0) (2025-11-09)


### Features

* Add homepage widget screenshot to README ([ee6b7f6](https://github.com/Schero94/Magic-Sessionmanager/commit/ee6b7f631b2ea9b5aa2aabea8be9914ca020ec26))

# [3.4.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.3.2...v3.4.0) (2025-11-09)


### Features

* Add screenshots for README documentation ([3c59705](https://github.com/Schero94/Magic-Sessionmanager/commit/3c597051914f1992d6bc1d0c3294ee010ff53bf6))

## [3.3.2](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.3.1...v3.3.2) (2025-11-09)


### Bug Fixes

* Increase test delays to 8+ seconds before refresh token test ([fbe5dad](https://github.com/Schero94/Magic-Sessionmanager/commit/fbe5dadfc8ec418672c483031199a4e51c895157))

## [3.3.1](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.3.0...v3.3.1) (2025-11-09)


### Bug Fixes

* Correct Strapi v5 refresh endpoint to /api/auth/refresh ([a4cccbf](https://github.com/Schero94/Magic-Sessionmanager/commit/a4cccbfe5014e05b49080b46d9732bc430bfb031))

# [3.3.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.2.1...v3.3.0) (2025-11-09)


### Features

* Complete Refresh Token tracking and blocking system ([0451590](https://github.com/Schero94/Magic-Sessionmanager/commit/0451590177e610be26f1120d1327f6a5aac2c8a4))

## [3.2.1](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.2.0...v3.2.1) (2025-11-09)


### Bug Fixes

* Allow admin users to view any user's sessions (fixes 403 error) ([87994de](https://github.com/Schero94/Magic-Sessionmanager/commit/87994deac122030dffa306d895081a970d49de3b))

# [3.2.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.1.0...v3.2.0) (2025-11-09)


### Features

* Add encryption key generator in Admin Panel with comprehensive docs ([fc24163](https://github.com/Schero94/Magic-Sessionmanager/commit/fc241633aa5c553fcbbf2c1710f85eb21207a60e))

# [3.1.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.0.2...v3.1.0) (2025-11-09)


### Features

* Add JWT encryption and unique session IDs for enhanced security ([9c6e265](https://github.com/Schero94/Magic-Sessionmanager/commit/9c6e265c4f3e0342d9d0929bac320cb812a8aff6))

## [3.0.2](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.0.1...v3.0.2) (2025-11-09)


### Bug Fixes

* Correct admin API route paths (remove /admin/ prefix) ([b238e85](https://github.com/Schero94/Magic-Sessionmanager/commit/b238e857c0cc5ba54f273eb2abe707af00bccfd1))

## [3.0.1](https://github.com/Schero94/Magic-Sessionmanager/compare/v3.0.0...v3.0.1) (2025-11-09)


### Bug Fixes

* Use admin API routes in admin components (fixes 401 error) ([98e2c88](https://github.com/Schero94/Magic-Sessionmanager/commit/98e2c88f97aaf821ebaf51a5da225ed9df5cf15b))

# [3.0.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v2.1.0...v3.0.0) (2025-11-09)


### Bug Fixes

* Change collectionName to magic_sessions to avoid conflicts ([9fd69e6](https://github.com/Schero94/Magic-Sessionmanager/commit/9fd69e6291e705376bdfbb18fc41d6ca236e7893))


### BREAKING CHANGES

* Database table name changed from 'sessions' to 'magic_sessions'

The generic name 'sessions' can conflict with other plugins or Strapi internals.
Using 'magic_sessions' ensures no naming conflicts.

- Changed: collectionName from 'sessions' to 'magic_sessions'
- Prevents: 'DB table sessions already exists' error
- Better namespacing for plugin data

Existing users (if any) will need to migrate data or clear the database.

# [2.1.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v2.0.5...v2.1.0) (2025-11-09)


### Features

* Hide session collection from Content Manager ([6a566a9](https://github.com/Schero94/Magic-Sessionmanager/commit/6a566a94b3d7fc6e99d4ea7bd3d85bb75bdbde39))

## [2.0.5](https://github.com/Schero94/Magic-Sessionmanager/compare/v2.0.4...v2.0.5) (2025-11-09)


### Bug Fixes

* Remove inversedBy from user relation (one-way relation) ([ed1f4f7](https://github.com/Schero94/Magic-Sessionmanager/commit/ed1f4f78d05e750e631a5e9b17442f8bb50060be))

## [2.0.4](https://github.com/Schero94/Magic-Sessionmanager/compare/v2.0.3...v2.0.4) (2025-11-09)


### Bug Fixes

* Use short key 'session' in content-types export (Strapi v5 requirement) ([0b5343c](https://github.com/Schero94/Magic-Sessionmanager/commit/0b5343c60b611fd9b94d13402eb19d90cbc3d718))

## [2.0.3](https://github.com/Schero94/Magic-Sessionmanager/compare/v2.0.2...v2.0.3) (2025-11-09)


### Bug Fixes

* Export contentTypes in server index to register session schema ([f87fdf4](https://github.com/Schero94/Magic-Sessionmanager/commit/f87fdf465c5f548a6a1b144dc13e596a47e44b0d))

## [2.0.2](https://github.com/Schero94/Magic-Sessionmanager/compare/v2.0.1...v2.0.2) (2025-11-09)


### Bug Fixes

* Include server and admin source files in NPM package ([8cbe0fd](https://github.com/Schero94/Magic-Sessionmanager/commit/8cbe0fd3e13e126a24d6b6c39e4a2150a136d881))

## [2.0.1](https://github.com/Schero94/Magic-Sessionmanager/compare/v2.0.0...v2.0.1) (2025-11-09)


### Bug Fixes

* Add missing session content-type schema ([4f8aa30](https://github.com/Schero94/Magic-Sessionmanager/commit/4f8aa309351f7e440e6eb77eab46ea79796025ac))

# [2.0.0](https://github.com/Schero94/Magic-Sessionmanager/compare/v1.0.1...v2.0.0) (2025-11-09)


### Bug Fixes

* Correct content-type UID from api:: to plugin:: namespace ([7451136](https://github.com/Schero94/Magic-Sessionmanager/commit/7451136fbaeaf742873dd80a6780ac6dfe27ffb9))


### BREAKING CHANGES

* Changed all references from 'api::session.session' to 'plugin::magic-sessionmanager.session'

- Fixed: Cannot destructure property 'kind' runtime error
- Updated: session.js service with correct UID
- Updated: session.js controller with correct UID
- Updated: bootstrap.js middleware with correct UID
- Updated: last-seen.js middleware with correct UID
- Updated: README.md documentation with correct UID

This fixes the error when using plugin via NPM:
'Cannot destructure property kind of strapi.getModel(...) as it is undefined'

## [1.0.1](https://github.com/Schero94/Magic-Sessionmanager/compare/v1.0.0...v1.0.1) (2025-11-09)


### Bug Fixes

* Fix styled-components v6 keyframes compatibility ([d3cfafc](https://github.com/Schero94/Magic-Sessionmanager/commit/d3cfafc582bee805a0af55ce83f5c37b578d6655))

# 1.0.0 (2025-11-09)


### Bug Fixes

* Add missing plugin entry files and LICENSE for NPM publishing ([ffc226c](https://github.com/Schero94/Magic-Sessionmanager/commit/ffc226cfac337e54bfa1b0ce4dd6656c275a23fd))
* Correct workflow step order - build before verify ([fe86334](https://github.com/Schero94/Magic-Sessionmanager/commit/fe86334a109aecba0e3a423738592d8144f5e601))


### Features

* Add NPM semantic-release and GitHub Actions workflows ([6ab4eab](https://github.com/Schero94/Magic-Sessionmanager/commit/6ab4eabb78aa05a2bbbec89aa0c47b2f8cd8d546))
