import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwvault-cache-sync-'));
process.env.BWVAULT_CACHE = cacheDir;
process.env.BWVAULT_HOME = path.join(cacheDir, 'session');

const { syncVault } = await import('../core/vault.js');
const sessionStore = await import('../core/session.js');
const cachePath = path.join(cacheDir, 'vault.json');
fs.writeFileSync(cachePath, JSON.stringify({
  savedAt: Date.now(),
  raw: { Ciphers: [], Folders: [], Profile: { RevisionDate: 'fixture' } },
}));

const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async () => {
  requests += 1;
  return new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } });
};

const session = {
  serverUrl: 'https://vault.bitwarden.com',
  accessToken: 'expired-session-fixture',
  refreshToken: null,
  symmetricKey: { encKey: new Uint8Array(32), macKey: new Uint8Array(32) },
};

try {
  const cached = await syncVault(session);
  assert.equal(cached.ciphers.length, 0);
  assert.equal(requests, 0, 'read-only inventory should reuse a fresh encrypted cache');

  await assert.rejects(
    () => syncVault(session, undefined, { forceRemote: true }),
    /Sync failed: 401/,
    'forced remote mode must surface an expired session instead of falling back to stale cache',
  );
  assert.equal(requests, 1, 'forced remote mode must contact the vault server');

  sessionStore.saveApiKeyCredentials({
    clientId: 'fixture-client',
    clientSecret: 'fixture-secret',
    email: 'fixture@example.invalid',
    serverUrl: session.serverUrl,
  });
  let syncRequests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/api/sync')) {
      syncRequests += 1;
      if (syncRequests === 1) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ Ciphers: [], Folders: [], Profile: { RevisionDate: 'renewed' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/identity/connect/token')) {
      return new Response(JSON.stringify({ access_token: 'renewed-session-fixture', refresh_token: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error('Unexpected fixture request');
  };
  const renewed = await syncVault(session, undefined, { forceRemote: true });
  assert.equal(renewed.ciphers.length, 0);
  assert.equal(syncRequests, 2, 'expired session should retry the remote sync after API-key login');
  assert.equal(session.accessToken, 'renewed-session-fixture');
  console.log('ok cache-sync: reads reuse cache; writes force remote sync, renew expired API-key sessions, and fail closed without renewal');
} finally {
  globalThis.fetch = originalFetch;
  fs.rmSync(cacheDir, { recursive: true, force: true });
}
