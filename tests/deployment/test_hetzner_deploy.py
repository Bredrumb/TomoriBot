import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("deploy_request", ROOT / "deploy/hetzner/deploy-request.py")
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


class FakeApi:
    def __init__(self):
        self.run = {
            "run_attempt": 1, "head_branch": "release", "head_repository": {"full_name": "example/TomoriBot"},
            "path": ".github/workflows/deploy-hetzner.yml", "event": "push", "status": "in_progress",
            "head_sha": "a" * 40,
        }
        self.jobs = {"total_count": 2, "jobs": [
            {"name": "publish", "conclusion": "success"}, {"name": "deploy", "status": "in_progress"},
        ]}
        self.tip = "a" * 40
        self.provider = "hetzner"

    def json(self, path):
        if "/jobs?" in path:
            return self.jobs
        if path == "/git/ref/heads/release":
            return {"object": {"sha": self.tip}}
        if path == "/actions/variables/ACTIVE_PROVIDER":
            return {"value": self.provider}
        return self.run


class DeploymentRequestTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeApi()
        self.config = {
            "repository": "example/TomoriBot", "target": "production",
            "app_repository": "docker.io/example/tomoribot",
            "search_repository": "docker.io/example/tomoribot-searxng",
        }

    def test_only_current_release_run_can_request_production(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, "CONFIG", Path(directory)):
            marker = Path(directory) / "production-enabled"
            marker.write_text("azure-fenced\n")
            self.assertEqual(deploy.verify_run(self.api, self.config, 123, 1), self.api.tip)
            for field, value in [
                ("head_branch", "main"), ("head_repository", {"full_name": "fork/TomoriBot"}),
                ("path", ".github/workflows/ci.yml"), ("event", "pull_request"),
                ("run_attempt", 2), ("status", "completed"), ("head_sha", "b" * 40),
            ]:
                with self.subTest(field=field):
                    original = self.api.run[field]
                    self.api.run[field] = value
                    with self.assertRaises(ValueError):
                        deploy.verify_run(self.api, self.config, 123, 1)
                    self.api.run[field] = original
            self.api.provider = "azure"
            with self.assertRaises(ValueError):
                deploy.verify_run(self.api, self.config, 123, 1)
            self.api.provider = "hetzner"
            marker.unlink()
            with self.assertRaises(FileNotFoundError):
                deploy.verify_run(self.api, self.config, 123, 1)

    def test_publishing_must_have_succeeded_in_this_attempt(self):
        self.config["target"] = "hetzner-staging"
        for jobs in [[], [{"name": "publish", "conclusion": "failure"}],
                     [{"name": "publish", "conclusion": "success"}]]:
            with self.subTest(jobs=jobs):
                self.api.jobs["jobs"] = jobs
                with self.assertRaises(ValueError):
                    deploy.verify_run(self.api, self.config, 123, 1)

    def test_request_is_bound_to_target_commit_and_image_repositories(self):
        valid = {"sha": self.api.tip, "target": "production", "recovery_point_opt_in": False,
                 "app_image": "docker.io/example/tomoribot@sha256:" + "b" * 64,
                 "search_image": "docker.io/example/tomoribot-searxng@sha256:" + "c" * 64}
        deploy.validate_request(valid, self.config, self.api.tip)
        for field, value in [("sha", "b" * 40), ("target", "hetzner-staging"),
                             ("recovery_point_opt_in", "true"), ("app_image", "example:latest"),
                             ("search_image", "docker.io/other/search@sha256:" + "c" * 64)]:
            with self.subTest(field=field):
                invalid = valid | {field: value}
                with self.assertRaises(ValueError):
                    deploy.validate_request(invalid, self.config, self.api.tip)

    def test_secrets_keep_host_database_keys_and_owner_restriction(self):
        current = {"DISCORD_TOKEN": "staging-token", "CRYPTO_SECRET": "legacy-key",
                   "CRYPTO_SECRET_V2": "second-key", "CRYPTO_SECRET_CURRENT": "2",
                   "VERTEX_ALLOWED_OWNERS": "111", "OLD_SETTING": "remove"}
        database = {"POSTGRES_HOST": "/var/run/postgresql", "POSTGRES_PORT": "5432", "POSTGRES_DB": "tomoribot",
                    "POSTGRES_USER": "tomoribot_runtime", "POSTGRES_PASSWORD": "local-password"}
        incoming = {"DISCORD_TOKEN": "staging-token", "POSTGRES_HOST": "source.postgres.database.azure.com",
                    "POSTGRES_PASSWORD": "source-password", "CRYPTO_SECRET_V1": "shadow-key",
                    "CRYPTO_SECRET_V2": "replacement", "VERTEX_ALLOWED_OWNERS": "", "NEW_SETTING": True}
        merged = deploy.merge_secrets(incoming, current, database, "production")
        for key, value in database.items():
            self.assertEqual(merged[key], value)
        for key in ("CRYPTO_SECRET", "CRYPTO_SECRET_V2", "CRYPTO_SECRET_CURRENT", "VERTEX_ALLOWED_OWNERS"):
            self.assertEqual(merged[key], current[key])
        self.assertNotIn("CRYPTO_SECRET_V1", merged)
        self.assertNotIn("OLD_SETTING", merged)
        self.assertEqual(merged["NEW_SETTING"], "true")
        for changed, target in [(incoming | {"DISCORD_TOKEN": "production-token"}, "hetzner-staging"),
                                (incoming | {"TOMORI_SUPPORTER_BILLING_ENABLED": True}, "hetzner-staging")]:
            with self.assertRaises(ValueError):
                deploy.merge_secrets(changed, current, database, target)
        with self.assertRaises(ValueError):
            deploy.merge_secrets(incoming, current | {"VERTEX_ALLOWED_OWNERS": ""}, database, "production")

    def test_artifact_digest_members_and_size_are_checked_before_reading(self):
        class ArtifactApi:
            def __init__(self, members):
                stream = io.BytesIO()
                with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    for name, content in members.items():
                        archive.writestr(name, content)
                self.content = stream.getvalue()
                self.artifact = {"id": 7, "name": "hetzner-request-1", "expired": False,
                                 "size_in_bytes": len(self.content),
                                 "digest": "sha256:" + hashlib.sha256(self.content).hexdigest()}

            def json(self, path):
                return {"total_count": 1, "artifacts": [self.artifact]}

            def fetch(self, path):
                return self.content

        api = ArtifactApi({"request.json": "{}", "runtime-secrets.json.gpg": "encrypted"})
        self.assertEqual(deploy.download_request(api, 123, 1), ({}, b"encrypted"))
        api.artifact["digest"] = "sha256:" + "0" * 64
        with self.assertRaises(ValueError):
            deploy.download_request(api, 123, 1)
        for members in [{"../request.json": "{}", "runtime-secrets.json.gpg": "encrypted"},
                        {"request.json": "{}", "runtime-secrets.json.gpg": "x" * (deploy.MAX_ARTIFACT + 1)}]:
            with self.assertRaises(ValueError):
                deploy.download_request(ArtifactApi(members), 123, 1)

    def test_download_redirect_strips_token_and_rejects_other_hosts(self):
        request = urllib.request.Request("https://api.github.com/example", headers={"Authorization": "Bearer test"})
        redirect = deploy.SafeRedirect()
        result = redirect.redirect_request(request, None, 302, "Found", {},
                                           "https://results.blob.core.windows.net/archive")
        self.assertFalse(result.has_header("Authorization"))
        for url in ["http://results.blob.core.windows.net/archive", "https://example.com/archive",
                    "https://results.blob.core.windows.net:8443/archive"]:
            with self.assertRaises(ValueError):
                redirect.redirect_request(request, None, 302, "Found", {}, url)

    def test_encrypted_payload_roundtrip_and_sudo_policy(self):
        subprocess.run(["visudo", "-cf", str(ROOT / "deploy/hetzner/runner.sudoers")],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            command = ["gpg", "--homedir", str(home), "--batch"]
            subprocess.run([*command, "--pinentry-mode", "loopback", "--passphrase", "",
                            "--quick-generate-key", "TomoriBot deployment fixture", "rsa3072", "encr", "0"],
                           check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            listing = subprocess.run([*command, "--with-colons", "--list-keys"],
                                     check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout
            fingerprint = next(line.split(":")[9] for line in listing.splitlines() if line.startswith("fpr:"))
            payload = json.dumps({"DISCORD_TOKEN": "fixture-token", "CRYPTO_SECRET": "fixture-key"}).encode()
            encrypted = subprocess.run([*command, "--trust-model", "always", "--recipient", fingerprint, "--encrypt"],
                                       input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout
            self.assertNotIn(payload, encrypted)
            decrypted = subprocess.run([*command, "--max-output", str(deploy.MAX_ARTIFACT), "--decrypt"],
                                       input=encrypted, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout
            self.assertEqual(decrypted, payload)
            oversized = subprocess.run([*command, "--max-output", "1", "--decrypt"],
                                       input=encrypted, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertNotEqual(oversized.returncode, 0)


if __name__ == "__main__":
    unittest.main()
