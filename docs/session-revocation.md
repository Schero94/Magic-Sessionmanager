# Session revocation storage

The plugin stores revoked access-token hashes in the hidden `revoked-token`
content type. The collection contains a SHA-256 hash, the JWT expiry when it can
be read, and the revocation time. It stores no plaintext token, refresh token,
user relation, IP address, or device data.

Session deletion and cleanup write the revocation record before removing the
session row. If that write fails, the deletion stops and the session row remains
available to the JWT verifier. The verifier checks the persistent hash record
before it checks session state. This applies in both relaxed and strict session
enforcement modes.

Cleanup removes records only after their JWT `exp` time. If the stored token
cannot be decrypted or has no valid expiry, the hash remains revoked. This
avoids accepting a token again because its session row was removed.

## Deployment note

The plugin registers the `magic_session_revocations` collection. Strapi 5.57.0
created the table during initialization of a disposable SQLite database. The
shared test-app source and its database were not changed.

## GeoIP download path

Downloads are limited to the canonical `data/magic-sessionmanager/geoip`
directory under the Strapi working directory. The setting accepts a supported
MMDB filename, such as `GeoLite2-City.mmdb`. Traversal, other directories,
unsupported extensions, and symlink destinations are rejected before any
download request. Legacy absolute paths may still be used for local database
reads, but they are not accepted as download destinations.
