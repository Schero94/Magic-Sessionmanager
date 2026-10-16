'use strict';

const { decryptToken, hashToken } = require('./encryption');

const REVOCATION_UID = 'plugin::magic-sessionmanager.revoked-token';
const REVOCATION_BATCH_SIZE = 500;

/**
 * Reads the expiry claim from plaintext JWT content without retaining the
 * token after this call.
 *
 * @param {string|null} token Plaintext JWT in local memory
 * @returns {Date|null} Expiry date, or null when the token has no known expiry
 */
function readJwtExpiry(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!Number.isFinite(payload.exp)) return null;

    const expiry = new Date(payload.exp * 1000);
    return Number.isNaN(expiry.getTime()) ? null : expiry;
  } catch {
    return null;
  }
}

/**
 * Reads the JWT expiry from the encrypted session token without retaining its
 * plaintext. Unknown or malformed tokens return null, which means the hash
 * must remain revoked until an operator can establish that it has expired.
 *
 * @param {string|null} encryptedToken AES-GCM ciphertext stored on a session
 * @returns {Date|null} JWT expiry, or null when it cannot be established
 */
function getAccessTokenExpiry(encryptedToken) {
  return readJwtExpiry(decryptToken(encryptedToken));
}

/**
 * Persists a minimal revocation record before a session row is removed.
 * Records contain only a SHA-256 token hash and timestamps. Tokens without a
 * readable expiry stay revoked indefinitely rather than becoming valid again.
 *
 * @param {object} strapi Strapi instance
 * @param {object} session Session fields including tokenHash and encrypted token
 * @param {Date} [now] Current time, injectable for deterministic tests
 * @returns {Promise<boolean>} Whether an unexpired token hash was retained
 * @throws {Error} If the revocation cannot be stored safely
 */
async function persistAccessTokenRevocation(strapi, session, now = new Date()) {
  const decryptedToken = decryptToken(session?.token);
  const storedHash = /^[a-f\d]{64}$/i.test(session?.tokenHash || '')
    ? session.tokenHash.toLowerCase()
    : null;
  const tokenHash = decryptedToken ? hashToken(decryptedToken) : storedHash;

  if (!tokenHash) return false;

  const expiresAt = readJwtExpiry(decryptedToken);
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return false;

  const documents = strapi.documents(REVOCATION_UID);
  const data = { tokenHash, expiresAt, revokedAt: now };
  const existing = await documents.findFirst({
    filters: { tokenHash },
    fields: ['documentId'],
  });

  if (existing) {
    await documents.update({ documentId: existing.documentId, data });
    return true;
  }

  try {
    await documents.create({ data });
    return true;
  } catch (createError) {
    // A concurrent delete can race the initial lookup. Re-read the unique key
    // and update the winner; if it is still absent, keep the session row.
    const racedRecord = await documents.findFirst({
      filters: { tokenHash },
      fields: ['documentId'],
    });
    if (!racedRecord) throw createError;

    await documents.update({ documentId: racedRecord.documentId, data });
    return true;
  }
}

/**
 * Deletes only revocation records whose JWT expiry has passed. A missing or
 * unknown expiry is intentionally never eligible for cleanup.
 *
 * @param {object} strapi Strapi instance
 * @param {Date} [now] Current time, injectable for deterministic tests
 * @returns {Promise<number>} Number of expired revocation records removed
 */
async function cleanupExpiredAccessTokenRevocations(strapi, now = new Date()) {
  const documents = strapi.documents(REVOCATION_UID);
  let deletedCount = 0;
  let noProgressBatches = 0;

  while (true) {
    const batch = await documents.findMany({
      filters: { expiresAt: { $lte: now } },
      fields: ['documentId'],
      sort: { expiresAt: 'asc' },
      limit: REVOCATION_BATCH_SIZE,
    });
    if (!batch?.length) break;

    let deletedInBatch = 0;
    for (const record of batch) {
      try {
        await documents.delete({ documentId: record.documentId });
        deletedInBatch++;
      } catch {
        // A failed deletion leaves the deny record in place, which is safe.
      }
    }

    deletedCount += deletedInBatch;
    noProgressBatches = deletedInBatch === 0 ? noProgressBatches + 1 : 0;
    if (noProgressBatches >= 3 || batch.length < REVOCATION_BATCH_SIZE) break;
  }

  return deletedCount;
}

module.exports = {
  REVOCATION_UID,
  cleanupExpiredAccessTokenRevocations,
  getAccessTokenExpiry,
  persistAccessTokenRevocation,
};
