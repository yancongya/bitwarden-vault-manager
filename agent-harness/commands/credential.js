/** Store service credentials in Bitwarden through stable, non-secret aliases. */

import * as session from '../core/session.js';
import { syncVault, invalidateCache } from '../core/vault.js';
import { createClient, decryptSymmetricKey, encryptString } from '../core/bridge.js';
import { getCredentialSecret, scrub } from '../utils/secrets.js';
import * as out from '../core/display.js';

const PREFIX = 'Agent Credential: ';

/**
 * Bitwarden's own item model is wider than this CLI used to expose. A service
 * credential is not always a username/password pair: browser cookie jars,
 * session bundles and multi-line JSON payloads belong in a Secure Note. Both
 * shapes are first-class here so callers never have to fake a password field.
 */
const ITEM_TYPES = {
  login: 1,
  note: 2,
  securenote: 2,
  card: 3,
  identity: 4,
  sshkey: 5,
};

const TYPE_NAMES = { 1: 'login', 2: 'note', 3: 'card', 4: 'identity', 5: 'sshkey' };

export function credentialItemName(alias) {
  return `${PREFIX}${alias}`;
}

export function normalizeAlias(alias) {
  const value = String(alias || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(value)) {
    throw new Error('--alias must be 2-80 characters using a-z, 0-9, dot, underscore or hyphen');
  }
  return value;
}

/** Map a friendly type name onto the numeric Bitwarden type. */
export function normalizeItemType(value, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback;
  const key = String(value).trim().toLowerCase().replace(/[\s_-]/g, '');
  const type = ITEM_TYPES[key];
  if (!type) {
    throw new Error(`--type must be one of: login, note, card, identity, sshkey (got "${value}")`);
  }
  return type;
}

/**
 * Parse repeatable `--field key=value` arguments into Bitwarden custom fields.
 * Custom fields carry the non-secret metadata that used to be crammed into
 * notes (endpoints, owner accounts, scopes).
 */
export function parseFields(raw) {
  const entries = Array.isArray(raw)
    ? raw
    : raw === undefined || raw === null || raw === ''
      ? []
      : [raw];
  return entries.map((entry) => {
    const text = String(entry);
    const at = text.indexOf('=');
    if (at <= 0) throw new Error(`--field expects key=value (got "${text}")`);
    return { name: text.slice(0, at).trim(), value: text.slice(at + 1) };
  });
}

function requireSession() {
  const value = session.loadSession();
  if (!value) throw new Error('Not authenticated. Run bwvault auth login first.');
  return value;
}

async function prepare(opts, { forceRemote = false } = {}) {
  const current = requireSession();
  const { ciphers } = await syncVault(current, (done, total) => {
    if (!opts.json) out.progress(done, total, 'decrypting');
  }, { forceRemote });
  const client = createClient(current.serverUrl);
  client.accessToken = current.accessToken;
  return { current, ciphers, client };
}

function findByAlias(ciphers, alias) {
  const name = credentialItemName(alias);
  return ciphers.filter((item) => !item.deletedDate && item.name === name);
}

export async function list(opts) {
  const { ciphers } = await prepare(opts);
  // Every type is listed: notes hold cookie jars and other non-login secrets.
  const items = ciphers
    .filter((item) => !item.deletedDate && item.name?.startsWith(PREFIX))
    .map((item) => ({
      alias: item.name.slice(PREFIX.length),
      type: item.typeName,
      username: item.login?.username || null,
      uri: item.login?.uris?.[0] || null,
      fields: (item.fields || []).map((f) => f.name),
      updatedAt: item.revisionDate,
      secret: 'stored',
    }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
  return {
    ok: true,
    count: items.length,
    items,
    headers: ['ALIAS', 'TYPE', 'USERNAME', 'URI', 'SECRET'],
    rows: items.map((item) => [item.alias, item.type, item.username || '', item.uri || '', 'stored']),
  };
}

/** Read one alias back by name, so scripts do not have to hunt for a cipher id. */
export async function get(opts) {
  const alias = normalizeAlias(opts.alias);
  const { ciphers } = await prepare(opts);
  const matches = findByAlias(ciphers, alias);
  if (!matches.length) throw new Error(`No credential alias "${alias}" in the vault.`);
  if (matches.length > 1) throw new Error(`Multiple vault items use alias "${alias}"; resolve duplicates first.`);

  const item = matches[0];
  const reveal = !!opts.reveal;
  // Notes carry the payload for a Secure Note; login secrets live in Password.
  const secretValue = item.type === 2 ? item.notes : item.login?.password;
  const fields = {};
  for (const f of item.fields || []) fields[f.name] = reveal ? f.value : '••••••••';

  return {
    ok: true,
    alias,
    type: item.typeName,
    username: item.login?.username || null,
    uri: item.login?.uris?.[0] || null,
    fields,
    secret: reveal ? secretValue : (secretValue ? '••••••••' : null),
    secretLen: secretValue ? secretValue.length : 0,
    updatedAt: item.revisionDate,
  };
}

export async function set(opts) {
  const alias = normalizeAlias(opts.alias);
  const fields = parseFields(opts.field);
  const requestedType = opts.type ? normalizeItemType(opts.type) : null;

  if (!opts.apply) {
    return {
      ok: true,
      dryRun: true,
      alias,
      type: TYPE_NAMES[requestedType || 1],
      fields: fields.map((f) => f.name),
      message:
        `Dry run: would save credential alias "${alias}"` +
        `${requestedType ? ` as ${TYPE_NAMES[requestedType]}` : ''}` +
        '. Add --apply and provide the secret via stdin, hidden prompt, or BWVAULT_SECRET.',
    };
  }

  const secret = await getCredentialSecret({ allowPrompt: !opts.json });
  if (!secret) throw new Error('Credential secret required via stdin, hidden prompt, or BWVAULT_SECRET.');

  try {
    const { current, ciphers, client } = await prepare(opts, { forceRemote: true });
    const name = credentialItemName(alias);
    const matches = findByAlias(ciphers, alias);
    if (matches.length > 1) throw new Error(`Multiple vault items use alias "${alias}"; resolve duplicates before saving.`);

    const existing = matches[0] || null;
    // An existing item keeps its own type unless the caller overrides it, so a
    // routine secret rotation never silently reshapes the entry.
    const itemType = requestedType || existing?.type || 1;

    let key = current.symmetricKey;
    if (existing?._original?.Key) key = await decryptSymmetricKey(existing._original.Key, current.symmetricKey);

    const enc = (value) => value ? encryptString(value, key) : Promise.resolve(null);
    const uri = opts.url ? [{ Uri: await enc(opts.url), Match: null }] : [];
    const login = {
      Username: await enc(opts.username || ''),
      Password: await enc(itemType === 1 ? secret : ''),
      Totp: null,
      Uris: uri,
    };

    // A Secure Note has no Login block — its payload is the note body itself,
    // stored verbatim so readers get back exactly what they wrote.
    const notes = itemType === 2
      ? secret
      : (opts.notes || `Managed by bwvault CLI\nalias=${alias}`);

    const customFields = await Promise.all(
      fields.map(async (f) => ({ Name: await enc(f.name), Value: await enc(f.value), Type: 0 }))
    );

    const payload = {
      Type: itemType,
      Name: await enc(name),
      Notes: await enc(notes),
      Favorite: false,
      Reprompt: 1,
      OrganizationId: null,
      FolderId: null,
      Fields: customFields.length ? customFields : null,
      Login: itemType === 1 ? login : null,
      SecureNote: itemType === 2 ? { Type: 0 } : null,
    };

    let result;
    if (existing) {
      const merged = { ...structuredClone(existing._original), ...payload };
      // Fields must be replaced wholesale — merging would resurrect removed ones.
      merged.Fields = payload.Fields;
      result = await client.updateCipher(existing.id, merged);
    } else {
      result = await client.createCipher(payload);
    }

    invalidateCache();
    return {
      ok: true,
      alias,
      type: TYPE_NAMES[itemType],
      action: existing ? 'updated' : 'created',
      id: result?.Id || result?.id || existing?.id || null,
      secret: 'stored-not-returned',
      message: `${existing ? 'Updated' : 'Created'} ${TYPE_NAMES[itemType]} credential alias "${alias}" without returning the secret.`,
    };
  } finally {
    scrub(secret);
  }
}
