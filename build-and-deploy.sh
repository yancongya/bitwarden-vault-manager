#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
if [ "$#" -eq 0 ]; then
  set -- plan
fi
exec python3 scripts/deploy_nas.py "$@"
