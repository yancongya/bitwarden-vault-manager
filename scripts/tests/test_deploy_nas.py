import subprocess
import tempfile
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import deploy_nas


class DeploymentPlanTests(unittest.TestCase):
    def project(self, root: Path) -> None:
        (root / "Dockerfile").write_text("FROM node:22-slim\n")
        (root / "package.json").write_text('{"name":"fixture"}\n')
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        subprocess.run(["git", "-C", str(root), "config", "user.email", "fixture@example.test"], check=True)
        subprocess.run(["git", "-C", str(root), "config", "user.name", "Fixture"], check=True)
        subprocess.run(["git", "-C", str(root), "add", "Dockerfile", "package.json"], check=True)
        subprocess.run(["git", "-C", str(root), "commit", "-qm", "fixture"], check=True)

    def test_clean_worktree_builds_immutable_release_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.project(root)
            plan = deploy_nas.build_plan(root)
        self.assertFalse(plan["blocked"])
        self.assertEqual(plan["image"], f"bwvault:release-{plan['sourceRevision'][:16]}")
        self.assertEqual(plan["platform"], "linux/amd64")
        self.assertEqual(plan["preservedDataMount"], "/vol1/1000/services/data/bwvault:/data")

    def test_dirty_worktree_blocks_deployment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.project(root)
            (root / "local-change").write_text("keep\n")
            plan = deploy_nas.build_plan(root)
        self.assertTrue(plan["blocked"])
        self.assertEqual(plan["dirtyPaths"], ["local-change"])

    def test_missing_project_files_block_deployment(self):
        with tempfile.TemporaryDirectory() as directory:
            plan = deploy_nas.build_plan(Path(directory))
        self.assertTrue(plan["blocked"])

    def test_apply_requires_both_clean_plan_and_explicit_confirmation(self):
        plan = {"blocked": False, "image": "bwvault:release-0123456789abcdef", "sourceRevision": "0123456789abcdef"}
        with patch.object(deploy_nas, "_run") as run:
            with self.assertRaisesRegex(RuntimeError, "--yes"):
                deploy_nas.apply_plan(plan, yes=False)
        run.assert_not_called()

    def test_remote_deploy_restores_previous_container_after_health_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            state_file = root / "docker-state.json"
            data_dir = root / "nas-data"
            data_dir.mkdir()
            state_file.write_text(json.dumps({"containers": {
                "bwvault": {"image": "bwvault:previous", "state": "running", "health": "healthy", "data": str(data_dir)}
            }}))
            sudo = fake_bin / "sudo"
            sudo.write_text('#!/bin/sh\n[ "$1" = -n ] && shift\nexec "$@"\n')
            docker = fake_bin / "docker"
            docker.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
state_path = Path(os.environ["FAKE_DOCKER_STATE"])
state = json.loads(state_path.read_text())
containers = state["containers"]
args = sys.argv[1:]
command = args[0]
def save(): state_path.write_text(json.dumps(state))
if command == "ps":
    print("\\n".join(containers))
elif command == "inspect":
    template, name = args[2], args[3]
    item = containers.get(name)
    if item is None: raise SystemExit(1)
    if ".Mounts" in template: print(item["data"])
    elif ".State.Status" in template: print(item["state"])
    elif ".State.Health" in template: print(item["health"])
    elif ".Config.Image" in template: print(item["image"])
elif command == "rename":
    _, old, new = args
    containers[new] = containers.pop(old)
    save()
elif command in ("stop", "start"):
    item = containers[args[1]]
    item["state"] = "exited" if command == "stop" else "running"
    save()
elif command == "run":
    name = args[args.index("--name") + 1]
    containers[name] = {"image": args[-1], "state": "running", "health": os.environ.get("FAKE_NEW_HEALTH", "healthy"), "data": os.environ.get("FAKE_DATA_DIR", "")}
    save()
    print("new-container-id")
''')
            sudo.chmod(0o755)
            docker.chmod(0o755)
            env = {**os.environ, "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
                   "FAKE_DOCKER_STATE": str(state_file), "FAKE_NEW_HEALTH": "unhealthy",
                   "FAKE_DATA_DIR": str(data_dir)}
            result = subprocess.run(
                ["bash", "-s", "--", "bwvault", "bwvault:release-0123456789abcdef", str(data_dir), "20261009-120000"],
                input=deploy_nas.REMOTE_DEPLOY, text=True, capture_output=True, env=env, check=False,
            )
            final = json.loads(state_file.read_text())["containers"]
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("previous container was restored and is healthy", result.stderr)
        self.assertEqual(final["bwvault"]["image"], "bwvault:previous")
        self.assertEqual(final["bwvault"]["state"], "running")
        self.assertEqual(final["bwvault-failed-20261009-120000"]["image"], "bwvault:release-0123456789abcdef")


if __name__ == "__main__":
    unittest.main()
