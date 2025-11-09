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
