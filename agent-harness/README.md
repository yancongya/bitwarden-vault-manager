# bwvault — Headless CLI for Bitwarden Vault Manager

Inspect, analyse and clean a Bitwarden vault without exposing plaintext.
Built on top of the audited browser crypto engine in `src/`; all decryption
happens locally, the master password never leaves your machine.

## Quick Start

```bash
# Interactive REPL (no arguments)
node bin/bwvault.js

# One-shot commands
node bin/bwvault.js auth status
node bin/bwvault.js vault list --json
node bin/bwvault.js analyze health
```

## Authentication

### API Key (recommended for automation)

```bash
export BWVAULT_CLIENT_ID="user.xxxx-xxxx-xxxx"
export BWVAULT_CLIENT_SECRET="xxxxx"
echo "$BWVAULT_PASSWORD" | node bin/bwvault.js auth login \
  --api-key \
  --email you@example.com
```

### Master Password (official Bitwarden login)

```bash
node bin/bwvault.js auth login --password --email you@example.com
```

Passwords are accepted via stdin, `BWVAULT_PASSWORD` env var, or interactive
prompt — never as bare command arguments.

## Commands

| Group | Command | Description |
|-------|---------|-------------|
| `auth` | `login` | Sign in (`--api-key` or `--password`) |
| `auth` | `logout` | Clear the stored session |
| `auth` | `status` | Show session info |
| `vault` | `sync` | Pull latest vault from server |
| `vault` | `list` | List entries (secrets redacted) |
| `vault` | `search` | Search entries |
| `vault` | `get --id` | Full detail for one entry |
| `vault` | `folders` | List folders |
| `vault` | `export` | Encrypted vault export |
| `analyze` | `health` | Weak / empty / reused / stale passwords |
| `analyze` | `duplicates` | Duplicate and same-site clusters |
| `analyze` | `urls` | Dead-link candidates |
| `manage` | `dedup` | Merge duplicate entries (`--dry-run` by default) |
| `manage` | `trash` | `list` · `restore` · `purge` |
| `manage` | `folders` | `create` · `rename` · `delete` |
| `credential` | `list` | List stable aliases and metadata; never returns secrets |
| `credential` | `set` | Create or update an alias; secret comes from stdin/prompt/env |

### Store a service credential

```bash
# Preview only; does not read or save the secret
node bin/bwvault.js credential set --alias nas.ssh --username tycon --url ssh://nas

# Save or update. The secret never appears in argv or command output.
printf '%s' "$SECRET" | node bin/bwvault.js credential set \
  --alias nas.ssh --username tycon --url ssh://nas --apply

node bin/bwvault.js credential list --json
```

### Global flags

| Flag | Effect |
|------|--------|
| `--json` | Machine-readable JSON on stdout |
| `--reveal` | Show secret values (use deliberately) |
| `--server` | `us` · `eu` · or a URL |

## Security Model

- **Encrypted cache**: only Bitwarden's encrypted API response is cached on
  disk; decrypted vault entries remain in process memory.
- **Default redaction**: passwords, TOTP codes, card numbers and private keys
  are replaced with `••••••••` in output. Use `--reveal` to opt in.
- **Digest-based duplicate detection**: two identical passwords produce the same
  SHA-256 digest so duplicates can be detected without holding plaintext in a
  shared data structure.
- **Session file**: the derived symmetric key (needed for decryption) is stored
  with `chmod 0600` in `~/.bwvault/session.json`. The master password is never
  written.
- **API-key bootstrap**: persisted API credentials are encrypted with
  scrypt + AES-256-GCM under the PIN. After a container/process restart, enter
  the PIN once before automatic session renewal can run.
- **All deletions are soft**: recoverable from trash for ~30 days. Only
  `trash purge --id <id> --apply --yes` is irreversible.
- **Credential aliases**: `credential set` reads the secret from stdin, a
  hidden prompt, or `BWVAULT_SECRET`; responses never contain the secret.

## Docker

```bash
docker build -t bwvault .
docker run --rm -v bwvault-data:/data bwvault auth status
docker run --rm -it -v bwvault-data:/data bwvault  # REPL
```

The container runs as UID 1000 (`bwvault`), with a single writable volume at
`/data/session` for session persistence.
