#!/usr/bin/env node
/**
 * bwvault — CLI for Bitwarden Vault Manager.
 *
 * Headless, scriptable control of a Bitwarden vault: authenticate, inspect,
 * analyse and clean up entries without ever putting plaintext on screen unless
 * you explicitly ask for it with --reveal.
 *
 * Cryptography is NOT reimplemented here: the audited browser engine in src/
 * is reused directly (see core/bridge.js). All decryption happens locally; the
 * master password never leaves the machine.
 *
 * Usage:
 *   bwvault auth login --api-key --email you@example.com   (key via stdin/env)
 *   bwvault vault list --json
 *   bwvault analyze health
 *   bwvault manage dedup --dry-run
 *
 * Run `bwvault <group> --help` for details, or with no args for the REPL.
 */

import { parseArgs } from 'node:util';
import * as out from '../core/display.js';
import * as auth from '../commands/auth.js';
import * as vaultCmd from '../commands/vault.js';
import * as analyzeCmd from '../commands/analyze.js';
import * as manageCmd from '../commands/manage.js';
import * as credentialCmd from '../commands/credential.js';
import { repl } from '../utils/repl.js';

const VERSION = '1.0.0';

const HELP = `
${out.color('bwvault', 'cyan')} ${out.color(`v${VERSION}`, 'dim')} — headless Bitwarden vault management

${out.color('USAGE', 'bold')}
  bwvault <group> <command> [options]

${out.color('GROUPS', 'bold')}
  ${out.color('auth', 'green')}      Authenticate and manage the local session
    login     Sign in (--api-key | --password)
    logout    Clear the stored session
    status    Show session info (never prints secrets)

  ${out.color('vault', 'green')}     Inspect and move data
    sync      Pull the latest vault from the server
    list      List entries (secrets redacted unless --reveal)
    search    Search entries by name/username/URI
    get       Show one entry in full (redacted unless --reveal)
    folders   List folders

  ${out.color('analyze', 'green')}   Read-only reporting (no vault mutation)
    health      Weak / empty / reused / stale passwords
    duplicates  Duplicate and same-site clusters
    urls        Dead-link candidates

  ${out.color('manage', 'green')}    Mutating operations (all support --dry-run)
    dedup     Merge duplicate entries (soft-delete, recoverable)
    trash     list | restore | purge  (purge is irreversible)
    folders   create | rename | delete

  ${out.color('credential', 'green')} Store service credentials by stable alias
    list      List aliases and metadata (never returns secrets)
    get       Read one alias back by name (--reveal for the secret)
    set       Create or update an alias (secret via stdin/prompt/env)
                --type login|note   note = Secure Note for cookie jars / JSON blobs
                --field key=value   repeatable custom field (endpoints, scopes)
                --notes "text"      note body for login entries

${out.color('GLOBAL OPTIONS', 'bold')}
  --json            Machine-readable output on stdout
  --reveal          Show secret values (passwords/TOTP/keys). Use deliberately.
  --server <url>    Server: us | eu | https://your.host  (default: us)
  -h, --help        Show help
  -v, --version     Show version

${out.color('SECRETS', 'bold')}
  The master password is NEVER accepted as a bare argument. Provide it via
  stdin, the BWVAULT_PASSWORD env var, or an interactive prompt.

${out.color('EXAMPLES', 'bold')}
  echo "$PW" | bwvault auth login --api-key --client-id user.x --client-secret s --email me@x.com
  bwvault vault list --json | jq '.items[].name'
  bwvault analyze health
  bwvault manage dedup --dry-run
  printf '%s' "$SECRET" | bwvault credential set --alias nas.ssh --username tycon --url ssh://nas --apply
  cat cookies.json | bwvault credential set --alias svc.cookies --type note --apply
  bwvault credential get --alias svc.cookies --reveal --json | jq -r '.secret'
`;

/**
 * Split argv into a group and the remaining args.
 */
function route(argv) {
  const [group, ...rest] = argv;
  return { group: group && !group.startsWith('-') ? group : null, rest };
}

async function main() {
  const argv = process.argv.slice(2);

  // Global flags handled before dispatch.
  const json = argv.includes('--json');

  if (!argv.length) {
    // No arguments -> interactive REPL (CLI-Anything default behaviour).
    return repl();
  }

  if (argv.includes('-h') || argv.includes('--help')) {
    if (argv.length === 1) {
      process.stdout.write(HELP);
      return 0;
    }
    // fall through: per-group help handled by commands
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const { group, rest } = route(argv);
  const reveal = argv.includes('--reveal');

  const ctx = { json, reveal, argv };

  switch (group) {
    case 'auth':
      return dispatchAuth(rest, ctx);
    case 'vault':
      return dispatchVault(rest, ctx);
    case 'analyze':
      return dispatchAnalyze(rest, ctx);
    case 'manage':
      return dispatchManage(rest, ctx);
    case 'credential':
      return dispatchCredential(rest, ctx);
    default:
      process.stdout.write(HELP);
      if (group) {
        out.fail(`Unknown group: ${group}`);
        return 1;
      }
      return 0;
  }
}

async function dispatchCredential(args, ctx) {
  const [cmd, ...rest] = args;
  const opts = parseOptions(rest, {
    alias: 'string',
    username: 'string',
    url: 'string',
    type: 'string',
    field: { type: 'string', multiple: true },
    notes: 'string',
    apply: 'boolean',
  });
  const common = { json: ctx.json, reveal: ctx.reveal, ...opts };

  switch (cmd) {
    case 'list':
      return credentialCmd.list(common);
    case 'get':
      return credentialCmd.get(common);
    case 'set':
      return credentialCmd.set(common);
    default:
      out.fail(`Unknown credential command: ${cmd}`);
      process.stdout.write('Available: list, get, set\n');
      return 1;
  }
}

/** Strip global flags so per-command parseArgs does not choke on them. */
function stripGlobals(args) {
  return args.filter((a) => !['--json', '--reveal'].includes(a));
}

async function dispatchAuth(args, ctx) {
  const [cmd, ...rest] = args;
  const opts = parseOptions(rest, {
    'client-id': 'string',
    'client-secret': 'string',
    email: 'string',
    password: 'boolean',
    server: 'string',
    'api-key': 'boolean',
    'set-pin': 'string',
  });
  const common = { json: ctx.json, server: opts.server };

  switch (cmd) {
    case 'login': {
      const loginPin = opts['set-pin'] || process.env.BWVAULT_PIN;
      // Map kebab-case CLI flags to the camelCase names the auth module uses.
      const mapped = {
        ...common,
        clientId: opts['client-id'] || process.env.BWVAULT_CLIENT_ID,
        clientSecret: opts['client-secret'] || process.env.BWVAULT_CLIENT_SECRET,
        email: opts.email,
        // --password selects this strategy. The secret itself comes from
        // stdin, BWVAULT_PASSWORD, or the interactive prompt.
        password: undefined,
        pin: loginPin,
      };
      if (opts['api-key']) {
        const result = await auth.loginApiKey(mapped);
        // Set Web access PIN after successful login if requested.
        if (loginPin && result.ok) {
          const { setPin } = await import('../core/session.js');
          await setPin(loginPin);
          result.pinSet = true;
        }
        return result;
      }
      // Default to password login when --api-key is absent.
      const result = await auth.loginPassword(mapped);
      if (loginPin && result.ok) {
        const { setPin } = await import('../core/session.js');
        await setPin(loginPin);
        result.pinSet = true;
      }
      return result;
    }
    case 'logout':
      return auth.logout();
    case 'status':
      return auth.status();
    default:
      out.fail(`Unknown auth command: ${cmd}`);
      process.stdout.write('Available: login, logout, status\n');
      return 1;
  }
}

async function dispatchVault(args, ctx) {
  const [cmd, ...rest] = args;
  const opts = parseOptions(rest, {
    type: 'string',
    folder: 'string',
    search: 'string',
    output: 'string',
    input: 'string',
    id: 'string',
    limit: 'string',
  });
  const common = { json: ctx.json, reveal: ctx.reveal, server: opts.server, ...opts };

  switch (cmd) {
    case 'sync':
      return vaultCmd.sync(common);
    case 'list':
      return vaultCmd.list(common);
    case 'search':
      return vaultCmd.search({ ...common, query: rest.find((a) => !a.startsWith('-')) });
    case 'get':
      return vaultCmd.get(common);
    case 'folders':
      return vaultCmd.folders(common);
    case 'export':
      return vaultCmd.exportVault(common);
    default:
      out.fail(`Unknown vault command: ${cmd}`);
      process.stdout.write('Available: sync, list, search, get, folders, export\n');
      return 1;
  }
}

async function dispatchAnalyze(args, ctx) {
  const [cmd, ...rest] = args;
  const opts = parseOptions(rest, { server: 'string' });
  const common = { json: ctx.json, ...opts };

  switch (cmd) {
    case 'health':
      return analyzeCmd.health(common);
    case 'duplicates':
      return analyzeCmd.duplicates(common);
    case 'urls':
      return analyzeCmd.urls(common);
    default:
      out.fail(`Unknown analyze command: ${cmd}`);
      process.stdout.write('Available: health, duplicates, urls\n');
      return 1;
  }
}

async function dispatchManage(args, ctx) {
  const [cmd, ...rest] = args;
  const opts = parseOptions(rest, {
    id: 'string',
    name: 'string',
    'dry-run': 'boolean',
    apply: 'boolean',
    yes: 'boolean',
  });
  const common = { json: ctx.json, ...opts };

  switch (cmd) {
    case 'dedup':
      return manageCmd.dedup(common);
    case 'trash':
      return manageCmd.trash({ ...common, action: rest.find((a) => !a.startsWith('-')) });
    case 'folders':
      return manageCmd.folders({ ...common, action: rest.find((a) => !a.startsWith('-')) });
    default:
      out.fail(`Unknown manage command: ${cmd}`);
      process.stdout.write('Available: dedup, trash, folders\n');
      return 1;
  }
}

/**
 * Thin wrapper over util.parseArgs that tolerates unknown flags
 * (so `--server us` works on any subcommand without redeclaring it).
 */
function parseOptions(args, known) {
  const options = { ...known, server: { type: 'string' } };
  const strict = Object.fromEntries(
    Object.entries(options).map(([k, v]) => [k, typeof v === 'string' ? { type: v } : v])
  );
  try {
    const { values } = parseArgs({ args: stripGlobals(args), options: strict, strict: false, allowPositionals: true });
    return values;
  } catch (e) {
    out.fail(`Argument error: ${e.message}`);
    return {};
  }
}

main()
  .then((result) => {
    if (result === undefined || result === null) return;
    if (typeof result === 'number') {
      process.exitCode = result;
      return;
    }
    // Structured result -> honour --json
    const json = process.argv.includes('--json');
    out.emit(result, { json });
    if (!json) {
      // Human rendering: pretty-print common shapes.
      if (Array.isArray(result?.items)) {
        out.printTable(result.headers || Object.keys(result.items[0] || {}), result.rows || []);
      } else if (result?.kv) {
        out.printKV(result.kv);
      } else if (result?.message) {
        out.ok(result.message);
      } else {
        // Fallback: surface the object so nothing is silently swallowed.
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      }
    }
  })
  .catch((err) => {
    out.fail(err?.message || String(err));
    if (process.env.BWVAULT_DEBUG) console.error(err);
    process.exitCode = 1;
  });
