'use strict';

const crypto = require('crypto');

/**
 * JWT Encryption Utility — AES-256-GCM for at-rest token storage.
 *
 * SECURITY POLICY
 * ---------------
 * In production NODE_ENV, SESSION_ENCRYPTION_KEY is MANDATORY. We used to
 * fall back to APP_KEYS / API_TOKEN_SALT, but Strapi documents APP_KEYS
 * as rotatable — and a rotation would make every previously-encrypted
 * token blob undecryptable, silently breaking all sessions.
 *
 * In non-production we permit a derived fallback so local dev setups
 * keep working without requiring the env var, and emit exactly one WARN
 * per process so nobody ships the derived key to production by accident.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

let warnedMissingKey = false;

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Returns the 32-byte AES-256 key for session-token encryption.
 *
 * @returns {Buffer} 32 bytes
 * @throws {Error} In production when SESSION_ENCRYPTION_KEY is missing
 */
function getEncryptionKey() {
  const envKey = process.env.SESSION_ENCRYPTION_KEY;

  if (envKey && envKey.length > 0) {
    return crypto.createHash('sha256').update(envKey).digest();
  }

  if (isProduction()) {
    throw new Error(
      '[magic-sessionmanager] FATAL: SESSION_ENCRYPTION_KEY is required in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  if (!warnedMissingKey) {
    warnedMissingKey = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[magic-sessionmanager] SESSION_ENCRYPTION_KEY not set — using dev fallback derived from ' +
      'APP_KEYS/API_TOKEN_SALT. Set this env var before deploying (it is NOT rotatable).'
    );
  }

  const fallback =
    (Array.isArray(process.env.APP_KEYS) ? process.env.APP_KEYS[0] : process.env.APP_KEYS) ||
    process.env.API_TOKEN_SALT ||
    'magic-sessionmanager-dev-fallback-DO-NOT-USE-IN-PRODUCTION';
  return crypto.createHash('sha256').update(fallback).digest();
}

/**
 * Encrypt JWT token before storing in database
 * @param {string} token - JWT token to encrypt
 * @returns {string} Encrypted token with IV and auth tag
 */
function encryptToken(token) {
  if (!token) return null;
  
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown encryption error';
    if (typeof strapi !== 'undefined' && strapi?.log) {
      strapi.log.error('[magic-sessionmanager/encryption] Encryption failed:', errMsg);
    }
    throw new Error('Failed to encrypt token');
  }
}

/**
 * Decrypt JWT token from database
 * @param {string} encryptedToken - Encrypted token from database
 * @returns {string} Decrypted JWT token
 */
function decryptToken(encryptedToken) {
  if (!encryptedToken) return null;
  
  try {
    const key = getEncryptionKey();
    
    // Parse: iv:authTag:encryptedData
    const parts = encryptedToken.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted token format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown decryption error';
    if (typeof strapi !== 'undefined' && strapi?.log) {
      strapi.log.error('[magic-sessionmanager/encryption] Decryption failed:', errMsg);
    }
    return null;
  }
}

/**
 * Generate unique session ID
 * Combines timestamp + random bytes + user ID for uniqueness
 * @param {number} userId - User ID
 * @returns {string} Unique session identifier
 */
function generateSessionId(userId) {
  const timestamp = Date.now().toString(36);
  const randomBytes = crypto.randomBytes(8).toString('hex');
  const userHash = crypto.createHash('sha256').update(userId.toString()).digest('hex').substring(0, 8);
  
  return `sess_${timestamp}_${userHash}_${randomBytes}`;
}

/**
 * Create a SHA-256 hash of a token for fast DB lookups
 * This allows O(1) session lookup without decrypting all tokens
 * @param {string} token - JWT token to hash
 * @returns {string} SHA-256 hash (64 hex chars)
 */
function hashToken(token) {
  if (!token) return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  encryptToken,
  decryptToken,
  generateSessionId,
  hashToken,
};

