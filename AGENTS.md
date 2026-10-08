# Bitwardenagents agent rules

> This file is the **single source of truth** for any AI agent that needs to
> interact with Bitwardenagents. Read it before taking any secret-related action.

## Production source of truth

- The production service is the existing NAS container `bwvault` on
  `tycon@192.168.31.110`.
- Its persistent bind mount is
  `/vol1/1000/services/data/bwvault:/data` and `BWVAULT_HOME=/data/session`.
- Web and CLI must share `/data/session`. Never diagnose production by starting
  `docker run -v bwvault-data:/data`; that named volume is a separate vault.

## How to call the CLI (from ANY agent / tool)

**You do NOT need** this repository cloned, a local Docker daemon, or any local
dependencies. The only requirement is SSH access to the NAS.

### Universal template

```bash
ssh tycon@192.168.31.110 \
  "sudo docker exec -i bwvault node /app/agent-harness/bin/bwvault.js <group> <command> [flags]"
```

If running from inside this repo (CI, dev machine with the wrapper), you may
alternatively use the wrapper which calls the same SSH + docker exec under the
hood:

```bash
./bitwardenagents <group> <command> [flags]
```

Both are equivalent. Prefer the direct SSH template when you are not in this
repo's working directory.

### Output handling

Do not merge stdout and stderr when consuming JSON. Keep progress messages on
stderr and parse only stdout. Never print output from `--reveal` in a chat or log.

## CLI command reference

### auth — session management

| Command | Description | Flags |
|---|---|---|
| `login --api-key` | Log in with API key (requires `--client-id`, `--client-secret`; master password via stdin) | |
| `login --password` | Log in with master password (via stdin) | |
| `login --set-pin <pin>` | Set Web UI access PIN | |
| `logout` | Clear stored session | |
| `status` | Show session info (never prints secrets) | `--json` |

### vault — data inspection

| Command | Description | Flags |
|---|---|---|
| `sync` | Pull latest vault from Bitwarden server | |
| `list` | List all vault items (secrets redacted) | `--json` |
| `search <keyword>` | Search by name / username / URI | `--json` |
| `get <item-id>` | Show one item in full | `--reveal` `--json` |
| `folders` | List folders | |

### credential — stable-alias service credentials

| Command | Description | Flags |
|---|---|---|
| `list` | List aliases and metadata (secrets always redacted) | |
| `set` | Create or update an alias | `--alias <name>` `--username` `--url` `--apply` |

**`credential set` accepts the secret ONLY via stdin, prompt, or env var.
Never pass it as a CLI argument.**

### analyze — read-only health checks

| Command | Description |
|---|---|
| `health` | Weak / empty / reused / stale password report |
| `duplicates` | Duplicate and same-site clusters |
| `urls` | Dead-link candidates |

### manage — vault mutations (all support `--dry-run`)

| Command | Description |
|---|---|
| `dedup` | Merge duplicate entries (soft-delete, recoverable) |
| `trash list/restore/purge` | Recycle bin (`purge` is irreversible) |
| `folders create/rename/delete` | Folder management |

### Global flags

| Flag | Description |
|---|---|
| `--json` | Machine-readable JSON output |
| `--reveal` | Show secret values (passwords, TOTP, keys). Requires explicit user authorization. |
| `--apply` | Commit changes (`credential set` without it is a dry-run) |
| `--server us\|eu\|<url>` | Bitwarden server (default: us) |

## Authentication lifecycle

- Current API-key credentials use the persistent `/data/session/agent-key` and
  renew automatically after expiry or container restart. Only legacy version 1
  credentials may require a one-time PIN migration in a private terminal.
- Check `bwvault auth status --json` first. After a `401`, retry once and inspect
  the actual error and credential version before recommending any login action.
- `authenticated: true` plus `/data/session/session.json` mode `600` is evidence
  of a stored session. A failed operation must report its actual error before
  recommending re-login.
- **Read operations** (list, search, status, get without --reveal) work from
  local cache and do NOT require an active API session.
- **Write operations** (set, dedup, trash purge) require a valid Bitwarden API
  session. If they return `createCipher FAILED: 401`, the session has expired.

## Secret handling

- Store infrastructure credentials as Bitwarden Login items through stable
  aliases: `printf '%s' "$SECRET" | ssh tycon@192.168.31.110 "sudo docker exec -i bwvault node /app/agent-harness/bin/bwvault.js credential set --alias <name> --apply"`.
- **Never** put a secret in argv, source files, Skill files, Git URLs, logs, or
  command output. Never print encrypted cipher request payloads either.
- `credential list` may show aliases and metadata but never secret values.
- Do not use `--reveal` unless the user explicitly authorizes disclosure for a
  specific operation. When authorizing, pipe the revealed value directly to its
  destination (e.g. `gh secret set`) without writing it to disk or displaying it.

Known alias registry (names only):

| Alias | Purpose | Scope |
|---|---|---|
| `blendproof.admin-login` | BlendProof site admin | Login |
| `blendproof.bootstrap-admin` | BlendProof first admin bootstrap | Login |
| `blendproof.share-access` | Worker runtime `SHARE_ACCESS_SECRET` | Secret |
| `blendproof.upload-signing` | Worker runtime `UPLOAD_SIGNING_SECRET` | Secret |
| `cloudflare.itycon.dns` | Cloudflare API Token | DNS management for `itycon.cn` only |
| `cloudflare.itycon.workers-deploy` | Cloudflare API Token | Workers deploy (Scripts:D1:R2:… Edit) |

Add future NAS, SSH, n8n, database, API and deployment credentials to this
registry by alias only. The value belongs in Bitwardenagents, not documentation.

## Changes and deployment

- Preserve unrelated dirty work and inspect recent commits before editing.
- Run syntax checks, `node agent-harness/tests/run.js`, `npm run build`, and
  `git diff --check` in proportion to the change.
- Use `./build-and-deploy.sh` for NAS replacement; verify health and actual
  mounts afterward. Permission to edit or deploy does not imply permission to
  commit or push.
