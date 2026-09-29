/**
 * Session persistence for the CLI.
 *
 * Stores only what is needed to talk to the API and decrypt locally:
 *   - serverUrl, accessToken, refreshToken
 *   - the derived symmetric key (encKey + macKey) as base64
 *
 * SECURITY NOTES
 *   - The session file is created with mode 0600 (owner read/write only).
 *   - The MASTER PASSWORD is never written to disk. It exists in memory only
 *     for the duration of a login and is discarded immediately after key
 *     derivation.
 *   - The symmetric key on disk is what allows decryption without re-entering
 *     the master password; treat the session dir as sensitive. Use
 *     `bwvault auth logout` to clear it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SESSION_DIR = process.env.BWVAULT_HOME || path.join(os.homedir(), '.bwvault');
const SESSION_FILE = path.join(SESSION_DIR, 'session.json');
const PIN_FILE = path.join(SESSION_DIR, 'pin.json');
const API_KEY_FILE = path.join(SESSION_DIR, 'api-key.json');
const AGENT_KEY_FILE = path.join(SESSION_DIR, 'agent-key');

// Device identity survives logout and container replacement on the /data volume.
export function getDeviceIdentifier() {
  ensureDir();
  const file = path.join(SESSION_DIR, 'device-id');
  if (fs.existsSync(file)) {
    try { fs.chmodSync(file, 0o600); } catch {}
    return fs.readFileSync(file, 'utf8').trim();
  }
  const id = loadSession()?.deviceIdentifier || crypto.randomUUID();
  try { fs.writeFileSync(file, id, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return fs.readFileSync(file, 'utf8').trim();
}

/**
 * Set a Web access PIN. New PINs use scrypt with a per-record salt. Legacy
 * SHA-256 records remain verifiable so an upgrade does not lock users out.
 */
export async function setPin(pin) {
  ensureDir();
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const payload = { hash: hash.toString('base64'), salt: salt.toString('base64'), kdf: 'scrypt', setAt: Date.now() };
  const fd = fs.openSync(PIN_FILE, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(payload));
  } finally {
    fs.closeSync(fd);
  }
  try { fs.chmodSync(PIN_FILE, 0o600); } catch {}
  return true;
}

/**
 * Verify a PIN against the stored hash. Returns true if it matches.
 */
export async function verifyPin(pin) {
  if (!fs.existsSync(PIN_FILE)) return false;
  try {
    const { hash, salt, kdf } = JSON.parse(fs.readFileSync(PIN_FILE, 'utf8'));
    if (kdf === 'scrypt') {
      const actual = crypto.scryptSync(String(pin), Buffer.from(salt, 'base64'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
      return crypto.timingSafeEqual(actual, Buffer.from(hash, 'base64'));
    }
    return (await sha256(salt + pin)) === hash;
  } catch {
    return false;
  }
}

/**
 * Check if a PIN has been set.
 */
export function hasPin() {
  return fs.existsSync(PIN_FILE);
}

/**
 * Remove the PIN (logout / reset).
 */
export function clearPin() {
  if (fs.existsSync(PIN_FILE)) fs.unlinkSync(PIN_FILE);
  return true;
}

/** Persist API-key credentials so agents can renew an expired session. */
function derivePinKey(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function getAgentKey() {
  ensureDir();
  if (fs.existsSync(AGENT_KEY_FILE)) {
    try { fs.chmodSync(AGENT_KEY_FILE, 0o600); } catch {}
    const key = Buffer.from(fs.readFileSync(AGENT_KEY_FILE, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error('Invalid persisted agent key.');
    return key;
  }
  const key = crypto.randomBytes(32);
  try { fs.writeFileSync(AGENT_KEY_FILE, key.toString('base64'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  try { fs.chmodSync(AGENT_KEY_FILE, 0o600); } catch {}
  return Buffer.from(fs.readFileSync(AGENT_KEY_FILE, 'utf8').trim(), 'base64');
}

function decryptCredentials(payload, key) {
  const iv = Buffer.from(payload.iv, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

export function saveApiKeyCredentials({ clientId, clientSecret, email, serverUrl }) {
  ensureDir();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getAgentKey(), iv);
  const plaintext = JSON.stringify({ clientId, clientSecret, email, serverUrl });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const payload = {
    version: 2,
    keySource: 'agent-key',
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  const fd = fs.openSync(API_KEY_FILE, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(payload)); }
  finally { fs.closeSync(fd); }
  try { fs.chmodSync(API_KEY_FILE, 0o600); } catch {}
}

export function loadApiKeyCredentials(pin) {
  if (!fs.existsSync(API_KEY_FILE)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(API_KEY_FILE, 'utf8'));
    // Legacy plaintext files are accepted only long enough to migrate after a
    // successful PIN verification. Callers must never return their contents.
    if (!payload.ciphertext) return pin ? payload : null;
    if (payload.version === 2 && payload.keySource === 'agent-key') {
      return decryptCredentials(payload, getAgentKey());
    }
    if (!pin) return null;
    return decryptCredentials(payload, derivePinKey(pin, Buffer.from(payload.salt, 'base64')));
  }
  catch { return null; }
}

export function migrateApiKeyCredentials(pin) {
  if (!fs.existsSync(API_KEY_FILE)) return null;
  const payload = JSON.parse(fs.readFileSync(API_KEY_FILE, 'utf8'));
  const credentials = loadApiKeyCredentials(pin);
  if (!credentials) return null;
  if (payload.version !== 2 || payload.keySource !== 'agent-key') {
    saveApiKeyCredentials(credentials);
  }
  return credentials;
}

// --- helpers ---
import crypto from 'node:crypto';

async function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function ensureDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
  }
}

const u8ToB64 = (u8) => Buffer.from(u8).toString('base64');
const b64ToU8 = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));

/**
 * Persist a session. Creates the file with 0600 before writing, so there is no
 * window where the key material is world-readable.
 */
export function saveSession(session) {
  ensureDir();
  const payload = {
    serverUrl: session.serverUrl,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken || null,
    encKey: u8ToB64(session.symmetricKey.encKey),
    macKey: u8ToB64(session.symmetricKey.macKey),
    email: session.email || null,
    kdf: session.kdf || null,
    deviceIdentifier: session.deviceIdentifier || null,
    savedAt: Date.now(),
  };

  // mode 0o600 on create; then chmod in case the file already existed loosely.
  const fd = fs.openSync(SESSION_FILE, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(payload, null, 2));
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(SESSION_FILE, 0o600);
  } catch {
    /* chmod unsupported (e.g. some Windows mounts) -- best effort */
  }
  return payload;
}

/**
 * Load the session, or null when absent/corrupt.
 */
export function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    return {
      ...raw,
      symmetricKey: {
        encKey: b64ToU8(raw.encKey),
        macKey: b64ToU8(raw.macKey),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Delete the session file (logout).
 */
export function clearSession() {
  if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
  return true;
}

/**
 * Non-secret session summary, safe to print.
 */
export function sessionStatus() {
  const s = loadSession();
  if (!s) {
    return { authenticated: false, sessionFile: SESSION_FILE };
  }
  let mode = null;
  try {
    mode = (fs.statSync(SESSION_FILE).mode & 0o777).toString(8);
  } catch {
    /* ignore */
  }
  return {
    authenticated: true,
    sessionFile: SESSION_FILE,
    fileMode: mode,
    serverUrl: s.serverUrl,
    email: s.email,
    savedAt: s.savedAt ? new Date(s.savedAt).toISOString() : null,
    // Age in minutes is handy for agents deciding whether to re-auth.
    ageMinutes: s.savedAt ? Math.round((Date.now() - s.savedAt) / 60000) : null,
  };
}

export const SESSION_PATHS = { SESSION_DIR, SESSION_FILE, API_KEY_FILE, AGENT_KEY_FILE };
