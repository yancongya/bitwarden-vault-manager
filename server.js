/**
 * Production server: serves the built web app + proxies Bitwarden API.
 * Replaces Vite dev server's proxy in production.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { migrateApiKeyCredentials, verifyPin } from './agent-harness/core/session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const PORT = parseInt(process.env.PORT || '3000', 10);
const SESSION_DIR = process.env.BWVAULT_HOME || path.join(__dirname, 'data');
const SESSION_FILE = path.join(SESSION_DIR, 'session.json');
const API_KEY_FILE = path.join(SESSION_DIR, 'api-key.json');
const SYNC_CACHE_FILE = path.join(SESSION_DIR, 'sync-cache.json');
const SYNC_CACHE_MAX_AGE = 10 * 60 * 1000;

let unlockedApiKeyCredentials = null;
const unlockedClients = new Map();
const UNLOCK_TTL_MS = 15 * 60 * 1000;
const pinFailures = new Map();
const PIN_MAX_FAILURES = 5;
const PIN_WINDOW_MS = 60 * 1000;

function getUnlockToken(req) {
  const match = String(req.headers.cookie || '').match(/(?:^|;\s*)bwvault_unlock=([^;]+)/);
  return match ? match[1] : null;
}

function hasClientUnlock(req) {
  const token = getUnlockToken(req);
  if (!token) return false;
  const expiresAt = unlockedClients.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    unlockedClients.delete(token);
    return false;
  }
  return true;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const expectedProtocol = req.socket.encrypted ? 'https:' : 'http:';
    const parsed = new URL(origin);
    return parsed.host === req.headers.host && parsed.protocol === expectedProtocol;
  } catch {
    return false;
  }
}

function clientAddress(req) {
  return req.socket.remoteAddress || 'unknown';
}

async function renewApiKeySession(session, pin) {
  if (!fs.existsSync(API_KEY_FILE)) return session;
  const credentials = unlockedApiKeyCredentials || migrateApiKeyCredentials(pin);
  if (!credentials) throw new Error('Unable to unlock saved API credentials.');
  unlockedApiKeyCredentials = credentials;
  const base = (credentials.serverUrl || session.serverUrl || 'https://vault.bitwarden.com').replace(/\/+$/, '');
  const identityUrl = base === 'https://vault.bitwarden.com'
    ? 'https://identity.bitwarden.com'
    : base === 'https://vault.bitwarden.eu'
      ? 'https://identity.bitwarden.eu'
      : `${base}/identity`;
  const tokenResponse = await fetch(`${identityUrl}/connect/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Bitwarden-Client-Version': '2026.8.1',
      'Bitwarden-Client-Name': 'web',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope: 'api',
      deviceType: '9',
      deviceIdentifier: session.deviceIdentifier,
      deviceName: 'Bitwarden Vault Manager',
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Bitwarden session renewal failed: ${tokenResponse.status}`);
  const token = await tokenResponse.json();
  session.accessToken = token.access_token;
  session.refreshToken = token.refresh_token || null;
  session.savedAt = Date.now();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
  return session;
}

// Bitwarden proxy targets (same as vite.config.js)
const PROXIES = {
  '/bw-identity': { target: 'https://identity.bitwarden.com', strip: '/bw-identity' },
  '/bw-eu-identity': { target: 'https://identity.bitwarden.eu', strip: '/bw-eu-identity' },
  '/bw-api': { target: 'https://api.bitwarden.com', strip: '/bw-api' },
  '/bw-eu-api': { target: 'https://api.bitwarden.eu', strip: '/bw-eu-api' },
};

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function proxyRequest(proxyPath, req, res) {
  const conf = PROXIES[proxyPath];
  const targetPath = req.url.replace(conf.strip, '') || '/';
  const url = new URL(targetPath, conf.target);

  const isVaultSync = proxyPath.endsWith('-api') && req.method === 'GET' && url.pathname === '/sync';
  let cacheAuthorized = false;
  try {
    const currentSession = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    cacheAuthorized = req.headers.authorization === `Bearer ${currentSession.accessToken}`;
  } catch {}
  if (isVaultSync && cacheAuthorized && fs.existsSync(SYNC_CACHE_FILE)) {
    try {
      const stat = fs.statSync(SYNC_CACHE_FILE);
      if (Date.now() - stat.mtimeMs < SYNC_CACHE_MAX_AGE) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-BWV-Cached': '1' });
        fs.createReadStream(SYNC_CACHE_FILE).pipe(res);
        return;
      }
    } catch { /* Fetch a fresh copy below. */ }
  }

  if (proxyPath.endsWith('-api') && !['GET', 'HEAD'].includes(req.method)) {
    try { fs.unlinkSync(SYNC_CACHE_FILE); } catch {}
  }

  const headers = { ...req.headers, host: url.host };
  delete headers['x-forwarded-for'];
  delete headers['x-real-ip'];

  const proxyReq = https.request(url, {
    method: req.method,
    headers,
    timeout: 30000,
  }, (proxyRes) => {
    if (isVaultSync && proxyRes.statusCode === 200) {
      const chunks = [];
      proxyRes.on('data', chunk => { chunks.push(chunk); res.write(chunk); });
      proxyRes.on('end', () => {
        res.end();
        try {
          fs.writeFileSync(SYNC_CACHE_FILE, Buffer.concat(chunks), { mode: 0o600 });
          fs.chmodSync(SYNC_CACHE_FILE, 0o600);
        } catch {}
      });
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      return;
    }
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error: ${err.message}`);
    if (!res.headersSent) res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  // --- Session API: shared between Web UI and CLI ---
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);

  // POST /api/session/verify — verify PIN and return session
  if (req.method === 'POST' && urlObj.pathname === '/api/session/verify') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { pin } = JSON.parse(body);
        const pinFile = path.join(path.dirname(SESSION_FILE), 'pin.json');
        if (!fs.existsSync(pinFile)) {
          // No PIN set — require the user to set one via CLI first
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'PIN not set. Run: bwvault auth login --set-pin <pin>' }));
          return;
        }
        const address = clientAddress(req);
        const failure = pinFailures.get(address);
        if (failure && failure.blockedUntil > Date.now()) {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil((failure.blockedUntil - Date.now()) / 1000)) });
          res.end(JSON.stringify({ ok: false, error: 'Too many PIN attempts. Try again later.' }));
          return;
        }
        if (!await verifyPin(pin)) {
          const next = failure && failure.expiresAt > Date.now() ? failure.count + 1 : 1;
          pinFailures.set(address, { count: next, expiresAt: Date.now() + PIN_WINDOW_MS, blockedUntil: next >= PIN_MAX_FAILURES ? Date.now() + PIN_WINDOW_MS : 0 });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid PIN' }));
          return;
        }
        pinFailures.delete(address);
        // PIN correct — return session
        if (fs.existsSync(SESSION_FILE)) {
          let session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
          // API-key access tokens do not include refresh tokens. A valid PIN
          // authorizes a transparent re-login using credentials in /data.
          session = await renewApiKeySession(session, pin);
          const unlockToken = crypto.randomBytes(32).toString('base64url');
          unlockedClients.set(unlockToken, Date.now() + UNLOCK_TTL_MS);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `bwvault_unlock=${unlockToken}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${UNLOCK_TTL_MS / 1000}`,
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ ok: true, session }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'No session. Run CLI login first.' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // GET /api/pin — check if PIN is set
  if (req.method === 'GET' && urlObj.pathname === '/api/pin') {
    const pinFile = path.join(path.dirname(SESSION_FILE), 'pin.json');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      pinSet: fs.existsSync(pinFile),
      unlocked: hasClientUnlock(req),
    }));
    return;
  }

  // POST /api/session — save session from Web UI
  if (req.method === 'POST' && urlObj.pathname === '/api/session') {
    const pinFile = path.join(path.dirname(SESSION_FILE), 'pin.json');
    if (!sameOrigin(req) || (fs.existsSync(pinFile) && !hasClientUnlock(req))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Same-origin request required.' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const session = JSON.parse(body);
        fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
        if (!session || typeof session !== 'object' || typeof session.serverUrl !== 'string' || typeof session.accessToken !== 'string') {
          throw new Error('Invalid session payload.');
        }
        fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // GET /api/session — load session for Web UI restore
  if (req.method === 'GET' && urlObj.pathname === '/api/session') {
    try {
      const pinFile = path.join(path.dirname(SESSION_FILE), 'pin.json');
      if (!fs.existsSync(pinFile)) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'PIN unlock is required before session restore.' }));
        return;
      }
      if (!hasClientUnlock(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'PIN unlock required.' }));
        return;
      }
      if (fs.existsSync(SESSION_FILE)) {
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, session: data }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
      }
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    }
    return;
  }

  // DELETE /api/session — clear session
  if (req.method === 'DELETE' && urlObj.pathname === '/api/session') {
    if (!sameOrigin(req) || !hasClientUnlock(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Authenticated same-origin request required.' }));
      return;
    }
    try {
      if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
      unlockedClients.clear();
      unlockedApiKeyCredentials = null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // --- Bitwarden proxy ---
  for (const prefix of Object.keys(PROXIES)) {
    if (req.url.startsWith(prefix)) {
      return proxyRequest(prefix, req, res);
    }
  }

  // Static file serving
  let requestedPath;
  try {
    requestedPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Invalid path');
    return;
  }
  let filePath = path.resolve(DIST, requestedPath === '/' ? 'index.html' : `.${requestedPath}`);
  const distPrefix = `${path.resolve(DIST)}${path.sep}`;
  if (filePath !== path.resolve(DIST, 'index.html') && !filePath.startsWith(distPrefix)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Invalid path');
    return;
  }

  // If no extension, try index.html (SPA fallback)
  if (!path.extname(filePath)) {
    filePath = path.join(DIST, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fallback to index.html for SPA routing
      fs.readFile(path.join(DIST, 'index.html'), (err2, data2) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`bwvault web server running on http://0.0.0.0:${PORT}`);
  console.log(`Web UI: http://localhost:${PORT}`);
  console.log(`Bitwarden proxy: /bw-api, /bw-identity`);
});

// --- HTTPS with auto-generated self-signed cert ---
// Web Crypto API (crypto.subtle) requires HTTPS or localhost in browsers.
// Generate a self-signed cert on first start so the dashboard works over LAN.
const CERT_DIR = path.join(path.dirname(SESSION_DIR), 'certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '3443', 10);

function ensureCerts() {
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) return;
  fs.mkdirSync(CERT_DIR, { recursive: true, mode: 0o700 });
  // Generate self-signed cert valid for 10 years, covering LAN IPs
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "${KEY_FILE}" -out "${CERT_FILE}" \
    -days 3650 -subj "/CN=bwvault-lan" \
    -addext "subjectAltName=IP:192.168.31.110,IP:127.0.0.1,DNS:localhost"`, {
    stdio: 'pipe',
  });
  fs.chmodSync(KEY_FILE, 0o600);
  console.log(`Self-signed cert generated at ${CERT_DIR}`);
}

try {
  ensureCerts();
  const httpsServer = https.createServer({
    cert: fs.readFileSync(CERT_FILE),
    key: fs.readFileSync(KEY_FILE),
  }, (req, res) => server.emit('request', req, res));
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`HTTPS (Web Crypto enabled): https://192.168.31.110:${HTTPS_PORT}`);
  });
} catch (e) {
  console.warn(`HTTPS setup failed (HTTPS won't be available): ${e.message}`);
}
