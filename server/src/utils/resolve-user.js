'use strict';

/**
 * Centralized user documentId resolver with LRU cache.
 * Wraps the deprecated entityService call so it only exists in one place.
 * When Strapi removes entityService, only this file needs updating.
 *
 * TTL: 5 minutes, Max size: 1000 entries
 */

const USER_UID = 'plugin::users-permissions.user';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 1000;

/**
 * Evicts expired and excess entries from the cache.
 */
function evict() {
  const now = Date.now();
  for (const [key, value] of cache) {
    if (now - value.ts >= CACHE_TTL) cache.delete(key);
  }
  if (cache.size >= CACHE_MAX_SIZE) {
    const keysToDelete = [...cache.keys()].slice(0, Math.floor(CACHE_MAX_SIZE / 4));
    keysToDelete.forEach(k => cache.delete(k));
  }
}

/**
 * Resolves a numeric user id to a documentId string.
 * Returns the input unchanged if it is already a non-numeric string (documentId).
 * @param {object} strapi
 * @param {string|number} userId - Numeric id or documentId
 * @returns {Promise<string|null>}
 */
async function resolveUserDocumentId(strapi, userId) {
  if (!userId) return null;

  if (typeof userId === 'string' && isNaN(userId)) {
    return userId;
  }

  const numericId = typeof userId === 'number' ? userId : parseInt(userId, 10);
  const cacheKey = `u_${numericId}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.documentId;
  }

  if (cache.size >= CACHE_MAX_SIZE) evict();

  try {
    const user = await strapi.entityService.findOne(USER_UID, numericId, {
      fields: ['documentId'],
    });

    if (user?.documentId) {
      cache.set(cacheKey, { documentId: user.documentId, ts: Date.now() });
      return user.documentId;
    }
  } catch {
    // silently handled
  }

  return null;
}

module.exports = { resolveUserDocumentId };
