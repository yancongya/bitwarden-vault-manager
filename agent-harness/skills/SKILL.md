---
name: cli-anything-bwvault
version: "1.0.0"
description: Headless CLI for Bitwarden Vault Manager — inspect, analyse and clean a Bitwarden vault without exposing plaintext
category: security
tags:
  - bitwarden
  - password-manager
  - vault
  - cli
  - zero-knowledge
trigger:
  - bitwarden
  - vault manager
  - password list
  - duplicate passwords
  - password health
  - bwvault
---

# cli-anything-bwvault

CLI harness for the Bitwarden Vault Manager web app. Allows an AI agent to
authenticate with a Bitwarden vault, inspect entries, analyse password health,
detect duplicates and perform safe cleanup — entirely from the terminal without
exposing any plaintext secrets.

For the user's NAS deployment, run the repository-root `./bitwardenagents`
proxy. It targets the existing `bwvault` container and shared `/data/session`;
do not start a temporary container with a separate named volume.

## Safety Rules

1. **Never print secrets** unless `--reveal` is explicitly passed.
2. **All mutations default to dry-run**; pass `--apply` to commit.
3. **Deletions are soft** (recoverable ~30 days); `purge` requires `--yes`.
4. **Passwords are never arguments**; provide via stdin / env / prompt.
5. **Production checks are read-only by default**; do not use `--apply`, purge,
   destructive Docker commands, unlock flows, or load testing without explicit
   user authorization.
6. **Never expose session material**: access tokens, refresh tokens, symmetric
   keys, API keys, PINs, and decrypted vault fields must not be printed, logged,
   pasted into reports, or placed in argv.
7. **Use the production proxy**: for NAS operations use `./bitwardenagents`,
   which targets the existing `bwvault` container and `/data/session`. Never
   start a separate named-volume vault to diagnose production.

## Web session and deployment security

- `/api/session` writes require a same-origin request. Do not weaken this check
  to make automation easier.
- PIN unlock is client-bound through a short-lived `HttpOnly`, `Secure`,
  `SameSite=Strict` cookie. A process-global boolean is not an authorization
  boundary.
- Do not expose HTTP port 3000 to untrusted networks. Prefer HTTPS 3443 behind
  a trusted reverse proxy and firewall 3000 to localhost or a management LAN.
- New PIN records use scrypt and the web endpoint applies failure throttling;
  preserve legacy verification compatibility when rotating PIN storage.
- Static resource requests must remain inside the built `dist` directory after
  URL decoding and normalization; never reintroduce direct path concatenation.
- Compose production defaults use localhost-only HTTP, read-only rootfs, and
  dropped Linux capabilities. Verify the deployed container matches them.
- Treat `/data/session` as highly sensitive. It contains material that can
  restore API access or decrypt cached vault data; preserve mode `0600` and the
  existing NAS bind mount.
- After changes to authentication, sessions, Docker, or deployment, run:

  ```bash
  npm run build
  node agent-harness/tests/run.js
  git diff --check
  ```

The current audit and remaining hardening work are recorded in
`docs/security-report.md`. Update it after every security-affecting change.

## Command Reference

```bash
# Session
BWVAULT_CLIENT_ID='<id>' BWVAULT_CLIENT_SECRET='<secret>' BWVAULT_PIN='<pin>' bwvault auth login --api-key --email <e>
bwvault auth login --password --email <e>
bwvault auth logout
bwvault auth status

# Inspection
bwvault vault sync
bwvault vault list [--type login] [--folder X] [--search Q] [--reveal]
bwvault vault search <query>
bwvault vault get --id <ID> [--reveal]
bwvault vault folders
bwvault vault export --output backup.enc

# Credential storage by stable alias
bwvault credential list [--json]
printf '%s' "$SECRET" | bwvault credential set --alias nas.ssh --username tycon --url ssh://nas --apply

# Analysis (read-only)
bwvault analyze health
bwvault analyze duplicates
bwvault analyze urls

# Mutations (dry-run by default)
bwvault manage dedup [--apply]
bwvault manage trash list
bwvault manage trash restore --id <ID> --apply
bwvault manage trash purge --id <ID> --apply --yes
bwvault manage folders create --name <NAME> --apply
bwvault manage folders rename --id <ID> --name <NAME> --apply
bwvault manage folders delete --id <ID> --apply

# Flags
--json     # machine-readable JSON output
--reveal   # show secrets (password, TOTP, keys)
--server   # us | eu | <custom-url>
```

Credential secrets are accepted only through stdin, a hidden prompt, or
`BWVAULT_SECRET`. `credential list` never returns secret values, and
`credential set` reports only whether the alias was created or updated.

## Key Behaviours for Agents

- `vault list --json` returns `{ items: [...], count }` — each item has `name`,
  `type`, `username`, `uris`, `password` (redacted by default).
- `analyze health --json` returns `{ score: 0-100, summary, details }` with
  counts of empty/weak/reused/stale passwords. Passwords are compared via
  SHA-256 digests, never plaintext.
- `manage dedup --dry-run` (default) returns the plan without mutating anything.
  Pass `--apply` to execute soft-deletes.
- Every mutating command returns `{ ok, message, ... }` so the agent can branch
  on success/failure without parsing stderr.

## Installation

```bash
cd agent-harness && npm install && npm link
# or simply:
node bin/bwvault.js <command>
```

## Architecture

The CLI reuses the **audited browser crypto engine** (`src/crypto.js`) directly
from Node.js — no reimplemented cryptography. Node 22's built-in Web Crypto API
(`crypto.subtle`) makes this transparent. Argon2id accounts use `@node-rs/argon2`
(prebuilt Rust binary) instead of `argon2-browser` (browser WASM).
