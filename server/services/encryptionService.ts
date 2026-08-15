import crypto from 'crypto';

// Use AES-256-GCM for encryption (authenticated encryption)
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;

// Get encryption key from environment (MUST be set in Replit Secrets)
// Fails fast if not configured to prevent insecure credential storage
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error(
      '[Encryption] CRITICAL: ENCRYPTION_KEY environment variable is not set. ' +
      'This is REQUIRED for secure credential storage. ' +
      'Please set a strong encryption key (min 32 characters) in Replit Secrets.'
    );
  }
  
  // Validate minimum length
  if (key.length < 32) {
    throw new Error(
      '[Encryption] CRITICAL: ENCRYPTION_KEY must be at least 32 characters long for security. ' +
      `Current length: ${key.length}`
    );
  }
  
  // Derive a 32-byte key from the environment variable
  return crypto.scryptSync(key, 'salt', 32);
}

/**
 * Encrypt sensitive data (like API credentials)
 * Uses AES-256-GCM for authenticated encryption
 */
export function encrypt(plaintext: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Combine IV + Auth Tag + Encrypted Data
    // Format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('[Encryption] Error encrypting data:', error);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt sensitive data
 * Uses AES-256-GCM for authenticated decryption
 */
export function decrypt(encryptedData: string): string {
  try {
    const key = getEncryptionKey();
    
    // Split the combined string
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('[Encryption] Error decrypting data:', error);
    throw new Error('Decryption failed');
  }
}

/**
 * Encrypt JSON object (commonly used for credentials)
 */
export function encryptJSON<T = any>(data: T): string {
  return encrypt(JSON.stringify(data));
}

/**
 * Decrypt JSON object
 */
export function decryptJSON<T = any>(encryptedData: string): T {
  return JSON.parse(decrypt(encryptedData));
}

/**
 * Hash a value (one-way, for comparison purposes)
 * Useful for storing hashed tokens
 */
export function hash(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

/**
 * Generate a secure random token
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Safely decrypt a value — returns the raw value if it is not in encrypted format.
 * Use for fields that may be stored as plaintext (legacy) or encrypted.
 */
export function safeDecrypt(value: string): string {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}
