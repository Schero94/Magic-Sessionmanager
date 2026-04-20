'use strict';

/**
 * Short-lived in-memory cache that lets the JWT-verify wrapper tell the
 * Koa response middleware WHY it rejected a particular token.
 *
 * The JWT verify function runs deep inside the users-permissions auth
 * middleware and does not have access to the Koa ctx, so we cannot
 * directly attach a header at that point. Instead the wrapper stashes
 * `tokenHash → reason` here; a tiny Koa middleware looks up the current
 * request's token hash after `await next()` and, on a 401, writes the
 * reason into the response (`X-Session-Terminated-Reason` header and a
 * `reason` field in the JSON body).
 *
 * Entries auto-expire after 60 s — long enough to survive the request
 * lifecycle but short enough that a token hash cannot accumulate stale
 * reasons. The map is bounded to `MAX_ENTRIES` (10 000) with an
 * opportunistic prune on every write to prevent unbounded growth under
 * rejection storms.
 */

const TTL_MS = 60 * 1000;
const MAX_ENTRIES = 10_000;

const cache = new Map();

const prune = () => {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
};

/**
 * Records why a token was rejected by the JWT-verify wrapper.
 *
 * @param {string} tokenHash  SHA-256 hex digest of the raw JWT
 * @param {'manual'|'idle'|'expired'|'blocked'} reason
 */
function setSessionRejectionReason(tokenHash, reason) {
  if (!tokenHash || !reason) return;
  if (cache.size >= MAX_ENTRIES) prune();
  cache.set(tokenHash, { reason, expiresAt: Date.now() + TTL_MS });
}

/**
 * Reads and consumes the stored rejection reason. Returns null if the
 * hash is unknown or its entry has expired. Reading removes the entry so
 * the same reason is never delivered twice.
 *
 * @param {string} tokenHash
 * @returns {string|null}
 */
function consumeSessionRejectionReason(tokenHash) {
  if (!tokenHash) return null;
  const entry = cache.get(tokenHash);
  if (!entry) return null;
  cache.delete(tokenHash);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.reason;
}

module.exports = {
  setSessionRejectionReason,
  consumeSessionRejectionReason,
};
