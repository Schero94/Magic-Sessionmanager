'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

/**
 * Marks a user update whose caller revokes the user's sessions itself, so the
 * `afterUpdate` lifecycle in register.js does not revoke them a second time.
 *
 * The admin block endpoint must surface revocation failures to the
 * administrator; the lifecycle swallows them. With this scope there is one
 * revocation path per request: the controller's. Blocks made anywhere else
 * (Content Manager, other plugins, direct document updates) run outside the
 * scope and are still revoked by the lifecycle.
 *
 * The scope travels with the async context of the update call only, so
 * concurrent requests for other users are unaffected.
 */
const storage = new AsyncLocalStorage();

/**
 * Runs `fn` while marking that the caller revokes `userDocumentId` itself.
 *
 * @template T
 * @param {string} userDocumentId Users & Permissions documentId
 * @param {() => Promise<T>} fn Update to run inside the scope
 * @returns {Promise<T>} Result of `fn`
 */
function runWithCallerRevocation(userDocumentId, fn) {
  return storage.run({ userDocumentId: String(userDocumentId) }, fn);
}

/**
 * Tells the lifecycle whether the current update belongs to a caller that
 * revokes this user's sessions itself.
 *
 * @param {string|undefined|null} userDocumentId Updated user's documentId
 * @returns {boolean} True when the lifecycle should skip its own revocation
 */
function isCallerRevocationScope(userDocumentId) {
  const scope = storage.getStore();
  return Boolean(scope && userDocumentId && scope.userDocumentId === String(userDocumentId));
}

module.exports = { runWithCallerRevocation, isCallerRevocationScope };
