/**
 * `bwvault auth` — authentication and session lifecycle.
 *
 * Two login strategies are supported, matching the web app:
 *   --api-key   Personal API Key (client_id + client_secret). Bypasses CAPTCHA
 *               and new-device verification. RECOMMENDED for automation.
 *   --password  Email + master password (official Bitwarden login). May trigger
 *               CAPTCHA or new-device email verification on unrecognised hosts.
 *
 * In both cases the master password is used locally for key derivation only and
 * is never transmitted. Only a PBKDF2-derived hash leaves the machine for the
 * password strategy, and nothing at all for the API-key strategy.
 */

import { createClient, makeMasterKey, stretchKey, hashPassword, decryptSymmetricKey, SERVER_PRESETS }
  from '../core/bridge.js';
import * as session from '../core/session.js';
import { getMasterPassword, getOneTimeCode, scrub } from '../utils/secrets.js';
import * as out from '../core/display.js';

/**
 * Resolve the server base URL from a friendly name or explicit URL.
 */
function resolveServer(server) {
  if (!server) return SERVER_PRESETS.us;
  const key = String(server).toLowerCase();
  if (SERVER_PRESETS[key]) return SERVER_PRESETS[key];
  return server.replace(/\/+$/, '');
}

/**
 * Shared tail of both login strategies: derive keys, verify we can decrypt the
 * protected symmetric key, then persist the session.
 */
async function finishLogin({ client, email, password, kdfConfig, encryptedKey, serverUrl, json }) {
  if (!encryptedKey) {
    throw new Error(
      'Login succeeded but the server returned no protected symmetric key. ' +
      'An organization-SSO or key-connector account may require the web app.'
    );
  }

  const masterKey = await makeMasterKey(password, email, kdfConfig);
  const stretched = await stretchKey(masterKey);
  const symmetricKey = await decryptSymmetricKey(encryptedKey, stretched);

  // Drop the password reference as early as possible.
  scrub(password);

  const payload = {
    serverUrl,
    accessToken: client.accessToken,
    refreshToken: client.refreshToken,
    symmetricKey,
    email,
    kdf: kdfConfig,
    deviceIdentifier: client.deviceIdentifier,
  };
  session.saveSession(payload);

  return {
    ok: true,
    email,
    serverUrl,
    kdf: kdfConfig.kdf === 1 ? 'argon2id' : 'pbkdf2',
    kdfIterations: kdfConfig.kdfIterations,
    sessionFile: session.SESSION_PATHS.SESSION_FILE,
  };
}

/** Personal API Key login. */
export async function loginApiKey(opts) {
  const clientId = opts.clientId;
  const clientSecret = opts.clientSecret;
  const email = opts.email;
  const serverUrl = resolveServer(opts.server);

  if (!clientId || !clientSecret || !email) {
    throw new Error('--client-id, --client-secret and --email are required for --api-key login');
  }
  if (!clientId.startsWith('user.')) {
    out.warn(`client_id "${clientId.slice(0, 12)}…" does not start with "user." — ` +
             'personal API keys normally do. Organization keys start with "organization.".');
  }

  const password = await getMasterPassword({ value: opts.password, allowPrompt: !opts.json });
  if (!password) {
    throw new Error(
      'Master password required (used locally to decrypt your vault key). ' +
      'Pass it via stdin, BWVAULT_PASSWORD, or run interactively.'
    );
  }

  const client = createClient(serverUrl);
  if (!opts.json) out.info('Authenticating with API key…');
  const result = await client.loginWithApiKey(clientId, clientSecret);

  const login = await finishLogin({
    client,
    email,
    password,
    // The login response carries authoritative KDF params (better than prelogin).
    kdfConfig: result.kdfConfig ?? { kdf: 0, kdfIterations: 600000, kdfMemory: 64, kdfParallelism: 4 },
    encryptedKey: result.encryptedKey,
    serverUrl,
    json: opts.json,
  });
  session.saveApiKeyCredentials({ clientId, clientSecret, email, serverUrl });
  return login;
}

/** Master-password (official) login, with new-device verification support. */
export async function loginPassword(opts) {
  const email = opts.email;
  const serverUrl = resolveServer(opts.server);

  if (!email) throw new Error('--email is required for --password login');

  const password = await getMasterPassword({ value: opts.password, allowPrompt: !opts.json });
  if (!password) {
    throw new Error('Master password required. Pass via stdin, BWVAULT_PASSWORD, or run interactively.');
  }

  const client = createClient(serverUrl);

  if (!opts.json) out.info('Fetching KDF parameters…');
  const kdfConfig = await client.prelogin(email);

  if (!opts.json) {
    out.info(`Deriving key (${kdfConfig.kdfIterations} iterations)…`);
  }
  const masterKey = await makeMasterKey(password, email, kdfConfig);
  const stretched = await stretchKey(masterKey);
  const hashedPassword = await hashPassword(password, masterKey);

  if (!opts.json) out.info('Logging in…');

  let result;
  try {
    result = await client.loginWithPassword(email, hashedPassword);
  } catch (err) {
    if (err.type !== 'new_device_required') throw err;

    // New device: Bitwarden emailed a one-time code. Ask for it and retry.
    out.warn('New device verification required — Bitwarden sent a code to your email.');
    const code = await getOneTimeCode();
    if (!code) throw new Error('No verification code supplied; aborting.');
    result = await client.verifyNewDevice(email, code);
  }

  // finishLogin re-derives from the password; reuse the already-derived
  // stretched key instead to avoid a second expensive KDF pass.
  const symmetricKey = await decryptSymmetricKey(result.encryptedKey, stretched);
  scrub(password);

  const payload = {
    serverUrl,
    accessToken: client.accessToken,
    refreshToken: client.refreshToken,
    symmetricKey,
    email,
    kdf: kdfConfig,
    deviceIdentifier: client.deviceIdentifier,
  };
  session.saveSession(payload);

  return {
    ok: true,
    email,
    serverUrl,
    kdf: kdfConfig.kdf === 1 ? 'argon2id' : 'pbkdf2',
    kdfIterations: kdfConfig.kdfIterations,
    sessionFile: session.SESSION_PATHS.SESSION_FILE,
  };
}

/** Clear the stored session. */
export function logout() {
  session.clearSession();
  return { ok: true, message: 'Session cleared.', sessionFile: session.SESSION_PATHS.SESSION_FILE };
}

/** Non-secret session summary. */
export function status() {
  return session.sessionStatus();
}
