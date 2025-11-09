'use strict';

const crypto = require('crypto');

/**
 * JWT Encryption Utility
 * Uses AES-256-GCM for secure token storage
 * 
 * SECURITY: Tokens are encrypted before storing in database
 * This prevents exposure if database is compromised
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get encryption key from environment or generate one
 * IMPORTANT: Set SESSION_ENCRYPTION_KEY in .env for production!
 */
function getEncryptionKey() {
  const envKey = process.env.SESSION_ENCRYPTION_KEY;
  
  if (envKey) {
    // Use provided key (must be 32 bytes for AES-256)
    const key = crypto.createHash('sha256').update(envKey).digest();
    return key;
  }
  
  // Fallback: Use Strapi's app keys (not recommended for production)
  const strapiKeys = process.env.APP_KEYS || process.env.API_TOKEN_SALT || 'default-insecure-key';
  const key = crypto.createHash('sha256').update(strapiKeys).digest();
  
  console.warn('[magic-sessionmanager/encryption] ⚠️  No SESSION_ENCRYPTION_KEY found. Using fallback (not recommended for production).');
  console.warn('[magic-sessionmanager/encryption] Set SESSION_ENCRYPTION_KEY in .env for better security.');
  
  return key;
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
    console.error('[magic-sessionmanager/encryption] Encryption failed:', err);
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
    console.error('[magic-sessionmanager/encryption] Decryption failed:', err);
    return null; // Return null if decryption fails (invalid/tampered token)
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

module.exports = {
  encryptToken,
  decryptToken,
  generateSessionId,
};

