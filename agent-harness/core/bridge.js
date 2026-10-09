/**
 * Bridge: reuse the browser crypto engine from Node.js.
 *
 * The vault logic lives in `src/` as ES modules written against the Web Crypto
 * API. Node 22 exposes the same globals (`crypto.subtle`, `TextEncoder`,
 * `fetch`, `atob`/`btoa`), so those modules run unmodified -- with one
 * exception: `argon2-browser` is a WASM bundle that cannot resolve its
 * `.wasm` asset under Node (Emscripten tries to `fetch()` a file path).
 *
 * This module does NOT reimplement any cryptography. It only:
 *   1. re-exports the audited `src/crypto.js` primitives, and
 *   2. supplies a Node-native Argon2id implementation for accounts whose KDF
 *      is Argon2id (PBKDF2 needs no help and stays zero-dependency).
 *
 * Design rule: never read, log or return vault plaintext unless a caller
 * explicitly opts in. See `security.js`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { getDeviceIdentifier } from './session.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// npm packages stage the canonical shared modules under runtime-src/. In a
// source checkout and Docker build, use the repository's single src/ copy.
const PACKAGED_SRC_DIR = path.resolve(__dirname, '..', 'runtime-src');
const REPO_SRC_DIR = path.resolve(__dirname, '..', '..', 'src');
const SRC_DIR = fs.existsSync(path.join(PACKAGED_SRC_DIR, 'crypto.js'))
  ? PACKAGED_SRC_DIR
  : REPO_SRC_DIR;
const srcPath = (f) => path.join(SRC_DIR, f);

// Re-exported, unmodified, from the browser engine.
export const {
  KdfType,
  stretchKey,
  hashPassword,
  decryptSymmetricKey,
  decryptCipherString,
  decryptToString,
  encryptString,
} = await import(srcPath('crypto.js'));

const apiMod = await import(srcPath('bitwarden-api.js'));
const BitwardenClient = apiMod.BitwardenClient;
export { BitwardenClient };

/**
 * Node-native Argon2id provider (`@node-rs/argon2`, prebuilt Rust binary).
 * Returns the raw 32-byte digest Bitwarden expects -- identical in role to
 * `argon2-browser`'s `result.hash`.
 */
async function argon2idNative(password, email, kdfConfig) {
  const mod = await import('@node-rs/argon2');
  // Bitwarden salts Argon2id with SHA-256(email), same as createArgon2Salt().
  const salt = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.toLowerCase().trim()))
  );
  const raw = await mod.hashRaw(Buffer.from(new TextEncoder().encode(password)), {
    salt: Buffer.from(salt),
    // Bitwarden stores memory in MiB; @node-rs/argon2 expects KiB.
    memoryCost: kdfConfig.kdfMemory * 1024,
    timeCost: kdfConfig.kdfIterations,
    parallelism: kdfConfig.kdfParallelism,
    outputLen: 32,
  });
  return new Uint8Array(raw);
}

/**
 * Derive the Master Key. Mirrors `makeMasterKey` from src/crypto.js but routes
 * Argon2id to a Node-native implementation instead of the browser WASM bundle.
 *
 * @param {string} password master password
 * @param {string} email    account email (salt)
 * @param {object} kdfConfig { kdf, kdfIterations, kdfMemory, kdfParallelism }
 * @returns {Promise<Uint8Array>} 32-byte master key
 */
export async function makeMasterKey(password, email, kdfConfig) {
  if (kdfConfig.kdf === KdfType.Argon2id) {
    return argon2idNative(password, email, kdfConfig);
  }

  // PBKDF2-SHA256: identical to src/crypto.js, kept here so the KDF choice is
  // resolved in one place for the CLI.
  const passwordBytes = new TextEncoder().encode(password);
  const saltBytes = new TextEncoder().encode(email.toLowerCase().trim());
  const key = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: kdfConfig.kdfIterations, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

/**
 * Server presets. The web app proxies through relative paths (`/bw-api`) via
 * Vite / Cloudflare Functions to dodge CORS. A CLI has no origin and no proxy,
 * so it must talk to absolute URLs -- the Bitwarden API permits direct calls
 * from non-browser clients.
 */
export const SERVER_PRESETS = {
  us: 'https://vault.bitwarden.com',
  eu: 'https://vault.bitwarden.eu',
};

/**
 * Build a BitwardenClient for the CLI.
 * @param {string} serverUrl absolute base URL (or '' to mean US/relative)
 */
export function createClient(serverUrl) {
  const url = serverUrl || SERVER_PRESETS.us;
  return new BitwardenClient(url, getDeviceIdentifier());
}
