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
