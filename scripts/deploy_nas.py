#!/usr/bin/env python3
"""Plan or guardedly deploy bwvault to its existing NAS service."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = "/vol1/1000/services/data/bwvault"
CONTAINER = "bwvault"
WRAPPER = Path(os.environ.get("AGENT_OPS_SSH_WRAPPER", Path.home() / ".skillshub/infra-ops/scripts/ssh-nas.sh")).expanduser()


def _run(argv: list[str], *, cwd: Path = ROOT, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, cwd=cwd, input=input_text, text=True, capture_output=True, check=False)


def build_plan(root: Path = ROOT) -> dict[str, object]:
    if not (root / "Dockerfile").is_file() or not (root / "package.json").is_file():
        return {"ok": False, "blocked": True, "reason": "Dockerfile/package.json missing", "project": str(root)}
    head = _run(["git", "-C", str(root), "rev-parse", "HEAD"], cwd=root)
    status = _run(["git", "-C", str(root), "status", "--porcelain", "--untracked-files=all"], cwd=root)
    if head.returncode or status.returncode:
        return {"ok": False, "blocked": True, "reason": "A clean Git worktree is required", "project": str(root)}
    revision = head.stdout.strip()
    dirty_paths = [line[3:] for line in status.stdout.splitlines() if line.strip()]
    release = f"release-{revision[:16]}" if len(revision) >= 16 else None
    blocked = bool(dirty_paths) or not release
    return {
        "ok": not blocked,
        "blocked": blocked,
        "mode": "dry-run",
        "project": str(root),
        "sourceRevision": revision,
        "dirtyPaths": dirty_paths,
        "image": f"bwvault:{release}" if release else None,
        "platform": "linux/amd64",
        "service": CONTAINER,
        "preservedDataMount": f"{DATA_DIR}:/data",
        "healthAcceptance": "Docker healthcheck=healthy and running image tag matches source revision",
        "automaticRecovery": "Keep the previous container; restore and start it if the candidate fails health acceptance",
        "message": "工作区不干净，部署被阻止" if blocked else "只显示部署计划；执行需要 apply --yes",
    }


REMOTE_DEPLOY = r'''set -eu
container="$1"; image="$2"; data_dir="$3"; stamp="$4"
previous="${container}-before-${stamp}"
failed="${container}-failed-${stamp}"
had_previous=0

sudo -n test -d "$data_dir" || { echo 'Refusing deploy: persistent data directory is missing.' >&2; exit 19; }
if sudo -n docker ps -a --format '{{.Names}}' | grep -qx "$container"; then
  actual_data=$(sudo -n docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$container")
  [ "$actual_data" = "$data_dir" ] || { echo 'Refusing deploy: existing /data bind mount does not match catalog.' >&2; exit 20; }
  sudo -n docker rename "$container" "$previous"
  had_previous=1
  sudo -n docker stop "$previous" >/dev/null
fi

wait_healthy() {
  name="$1"
  for _ in $(seq 1 30); do
    state=$(sudo -n docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || true)
    health=$(sudo -n docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || true)
    [ "$state" = running ] && [ "$health" = healthy ] && return 0
    [ "$health" = unhealthy ] && return 1
    sleep 1
  done
  return 1
}

restore_previous() {
  if sudo -n docker ps -a --format '{{.Names}}' | grep -qx "$container"; then
    sudo -n docker stop "$container" >/dev/null 2>&1 || true
    sudo -n docker rename "$container" "$failed" || return 1
  fi
  if [ "$had_previous" -eq 1 ]; then
    sudo -n docker rename "$previous" "$container" || return 1
    sudo -n docker start "$container" >/dev/null || return 1
    if wait_healthy "$container"; then
      echo 'Deployment failed; the previous container was restored and is healthy.' >&2
      return 0
    fi
    echo 'CRITICAL: previous container was restored but did not pass health acceptance.' >&2
    return 1
  fi
  echo 'Deployment failed; no prior container existed to restore.' >&2
  return 0
}

if ! sudo -n docker run -d --name "$container" --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -p 3443:3443 \
  -v "$data_dir:/data" -e BWVAULT_HOME=/data/session \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:size=10M "$image" >/dev/null; then
  restore_previous || exit 21
  exit 1
fi

if wait_healthy "$container"; then
  actual_image=$(sudo -n docker inspect --format '{{.Config.Image}}' "$container")
  [ "$actual_image" = "$image" ] || { restore_previous || exit 21; exit 1; }
  echo "Deployment accepted: image=$actual_image health=healthy dataMount=$data_dir:/data"
  exit 0
fi

restore_previous || exit 21
exit 1
'''


def apply_plan(plan: dict[str, object], *, yes: bool) -> dict[str, object]:
    if plan.get("blocked"):
        raise RuntimeError("部署被工作区保护规则阻止")
    if not yes:
        raise RuntimeError("执行需要显式传 --yes")
    if not WRAPPER.is_file():
        raise RuntimeError("SkillDo 管理的 infra-ops SSH wrapper 不存在")
    image = str(plan["image"])
    build = _run(["docker", "buildx", "build", "--platform", "linux/amd64", "--load", "-t", image, "."])
    if build.returncode:
        raise RuntimeError(build.stderr.strip() or "Docker image build failed")

    with subprocess.Popen(["docker", "save", image], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as source:
        assert source.stdout is not None
        load = subprocess.run([str(WRAPPER), "sudo -n docker load"], stdin=source.stdout, text=False, capture_output=True, check=False)
        source.stdout.close()
        save_stderr = source.stderr.read().decode(errors="replace") if source.stderr else ""
        save_status = source.wait()
    if save_status or load.returncode:
        raise RuntimeError((load.stderr.decode(errors="replace") or save_stderr or "Image transfer/load failed").strip())

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    command = "bash -s -- " + " ".join(shlex.quote(value) for value in (CONTAINER, image, DATA_DIR, stamp))
    deployed = subprocess.run([str(WRAPPER), command], input=REMOTE_DEPLOY, text=True, capture_output=True, check=False)
    if deployed.returncode:
        raise RuntimeError(deployed.stderr.strip() or deployed.stdout.strip() or f"NAS deploy failed ({deployed.returncode})")
    return {"ok": True, "sourceRevision": plan["sourceRevision"], "image": image, "output": deployed.stdout.strip()}


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe bwvault NAS deployment plan and guarded apply")
    sub = parser.add_subparsers(dest="command", required=True)
    plan_parser = sub.add_parser("plan", help="show a local dry-run deployment plan")
    plan_parser.add_argument("--json", action="store_true")
    apply_parser = sub.add_parser("apply", help="build and deploy after explicit confirmation")
    apply_parser.add_argument("--yes", action="store_true", help="confirm NAS replacement")
    apply_parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    plan = build_plan()
    if args.command == "plan":
        print(json.dumps(plan, ensure_ascii=False, indent=2) if args.json else json.dumps(plan, ensure_ascii=False, indent=2))
        return 0
    try:
        result = apply_plan(plan, yes=args.yes)
    except (OSError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else result["output"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
