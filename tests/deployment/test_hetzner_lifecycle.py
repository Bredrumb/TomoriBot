import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path("/etc/tomoribot")
STATE = Path("/var/lib/tomoribot-deploy")
TIMERS = ["tomoribot-watchdog.timer", "tomoribot-restart.timer", "tomoribot-backup.timer"]


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        if not Path("/.dockerenv").exists() or Path("/var/run/docker.sock").exists():
            raise RuntimeError("Run deployment tests in their isolated test image without a Docker socket.")
        for directory in (CONFIG, STATE):
            shutil.rmtree(directory, ignore_errors=True)
            directory.mkdir(parents=True)
        shutil.copytree(ROOT / "deploy/hetzner", CONFIG, dirs_exist_ok=True)
        self.previous_env = "TOMORIBOT_IMAGE=docker.io/example/app@sha256:" + "a" * 64 + "\nSEARXNG_IMAGE=docker.io/example/search@sha256:" + "b" * 64 + "\n"
        (CONFIG / ".env").write_text(self.previous_env)
        (CONFIG / "secrets.json").write_text(json.dumps({"DISCORD_TOKEN": "fixture-token"}))
        stage = STATE / ".request-fixture"
        stage.mkdir()
        (stage / "request.json").write_text(json.dumps({
            "app_image": "docker.io/example/app@sha256:" + "c" * 64,
            "search_image": "docker.io/example/search@sha256:" + "d" * 64,
            "recovery_point_opt_in": True,
        }))
        (stage / "secrets.json").write_text(json.dumps({"DISCORD_TOKEN": "fixture-token", "NEW_SETTING": "enabled"}))
        for name in ("docker", "systemctl", "curl", "sleep", "timeout", "base64"):
            binary = Path("/usr/local/bin") / name
            binary.unlink(missing_ok=True)
            binary.symlink_to(ROOT / "tests/deployment/fake_host.py")
        (ROOT / "tests/deployment/fake_host.py").chmod(0o755)

    def run_deployment(self, mode, active=None, enabled=None):
        Path("/tmp/fake-host.json").write_text(json.dumps({
            "mode": mode, "app": True, "tunnel": True, "active": TIMERS.copy() if active is None else active,
            "enabled": TIMERS.copy() if enabled is None else enabled, "migrated": False, "commands": [],
        }))
        result = subprocess.run(["bash", str(CONFIG / "deploy.sh"), str(STATE / ".request-fixture")],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        state = json.loads(Path("/tmp/fake-host.json").read_text())
        return result, state

    def test_success_quiesces_before_backup_and_starts_timers_after_health(self):
        result, state = self.run_deployment("success")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertTrue(state["app"] and state["tunnel"] and state["migrated"])
        self.assertEqual(set(state["active"]), set(TIMERS))
        self.assertEqual(set(state["enabled"]), set(TIMERS))
        self.assertFalse((STATE / "recovery-required").exists())
        commands = state["commands"]
        stop = next(index for index, command in enumerate(commands) if command[0] == "docker" and "stop" in command)
        backup = commands.index(["systemctl", "start", "tomoribot-backup.service"])
        gate = next(index for index, command in enumerate(commands) if any("checkPendingMigrations.ts" in arg for arg in command))
        migrate = next(index for index, command in enumerate(commands) if "src/db/initializeCli.ts" in command)
        audit = next(index for index, command in enumerate(commands) if "audit-keys" in command)
        start = next(index for index, command in enumerate(commands) if "up" in command and command[-1] == "tomoribot")
        timer = commands.index(["systemctl", "start", TIMERS[0]])
        self.assertTrue(stop < backup < gate < migrate < audit < start < timer)
        self.assertIn("40", commands[stop])
        self.assertEqual((STATE / "recovery/previous.env").read_text(), self.previous_env)

    def test_failure_before_migration_recovers_previous_configuration_and_timers(self):
        for mode in ("backup-failure", "gate-failure", "backup-running"):
            with self.subTest(mode=mode):
                self.setUp()
                result, state = self.run_deployment(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(state["migrated"])
                self.assertTrue(state["app"] and state["tunnel"])
                self.assertEqual(set(state["active"]), set(TIMERS))
                self.assertEqual(set(state["enabled"]), set(TIMERS))
                self.assertEqual((CONFIG / ".env").read_text(), self.previous_env)
                self.assertNotIn("NEW_SETTING", json.loads((CONFIG / "secrets.json").read_text()))
                self.assertFalse((STATE / "recovery-required").exists())

    def test_migration_audit_or_shard_failure_leaves_gateway_fenced(self):
        for mode in ("migration-failure", "audit-failure", "missing-shard", "tunnel-failure"):
            with self.subTest(mode=mode):
                self.setUp()
                result, state = self.run_deployment(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(state["migrated"])
                self.assertFalse(state["app"] or state["tunnel"])
                self.assertFalse(state["active"])
                self.assertFalse(state["enabled"])
                self.assertTrue((STATE / "recovery-required").exists())
                self.assertFalse(any("--restart=unless-stopped" in command for command in state["commands"]))

    def test_active_and_enabled_timer_states_are_restored_independently(self):
        active, enabled = [TIMERS[0]], [TIMERS[1]]
        result, state = self.run_deployment("success", active, enabled)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(state["active"], active)
        self.assertEqual(state["enabled"], enabled)

    def test_azure_fence_blocks_every_privileged_entry_point(self):
        (CONFIG / "provider-fenced").touch()
        Path("/var/lib/waagent").mkdir(parents=True, exist_ok=True)
        environment = os.environ | {key: "fixture" for key in (
            "runtimeSecretsB64", "migrationSecretsB64", "vertexConfigB64", "composeConfigB64",
            "dockerHubUsername", "dockerHubTokenB64", "searxngImage",
        )} | {"initializeSchema": "false", "tomoribotImage": "example/app@sha256:" + "a" * 64}
        for script in ("bootstrap-database.sh", "migrate-database.sh", "run-command-deploy.sh"):
            with self.subTest(script=script):
                Path("/tmp/fake-host.json").write_text(json.dumps({"commands": [], "mode": "success"}))
                result = subprocess.run(["bash", str(ROOT / "deploy/azure" / script)], env=environment,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(json.loads(Path("/tmp/fake-host.json").read_text())["commands"], [])


if __name__ == "__main__":
    unittest.main()
