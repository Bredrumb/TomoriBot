#!/usr/bin/python3
import fcntl
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
import urllib.parse
import urllib.request
import zipfile


CONFIG = Path("/etc/tomoribot/deploy")
STATE = Path("/var/lib/tomoribot-deploy")
MAX_ARTIFACT = 2 * 1024 * 1024


def require(condition):
    if not condition:
        raise ValueError("Deployment verification failed.")


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urllib.parse.urlparse(newurl)
        host = target.hostname or ""
        require(target.scheme == "https" and target.port in (None, 443))
        require(host.endswith((".githubusercontent.com", ".blob.core.windows.net", ".github.com")))
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        redirected.remove_header("Authorization")
        return redirected


class GitHub:
    def __init__(self, repository, token):
        require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository))
        self.base = f"https://api.github.com/repos/{repository}"
        self.token = token

    def fetch(self, path, limit=MAX_ARTIFACT):
        request = urllib.request.Request(self.base + path, headers={
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "TomoriBot-deployment",
        })
        with urllib.request.build_opener(SafeRedirect()).open(request, timeout=30) as response:
            content = response.read(limit + 1)
        require(len(content) <= limit)
        return content

    def json(self, path):
        return json.loads(self.fetch(path))


def verify_run(api, config, run_id, attempt):
    run = api.json(f"/actions/runs/{run_id}")
    require(run["run_attempt"] == attempt)
    require(run["head_branch"] == "release")
    require(run["head_repository"]["full_name"] == config["repository"])
    require(run["path"] == ".github/workflows/deploy-hetzner.yml")
    require(run["event"] in ("push", "workflow_dispatch"))
    require(run["status"] == "in_progress")
    require(re.fullmatch(r"[0-9a-f]{40}", run["head_sha"]))
    require(api.json("/git/ref/heads/release")["object"]["sha"] == run["head_sha"])
    jobs = api.json(f"/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100")
    require(jobs["total_count"] <= 100)
    require(any(job["name"] == "publish" and job["conclusion"] == "success" for job in jobs["jobs"]))
    require(any(job["name"] == "deploy" and job["status"] == "in_progress" for job in jobs["jobs"]))
    if config["target"] == "production":
        require(api.json("/actions/variables/ACTIVE_PROVIDER")["value"] == "hetzner")
        require((CONFIG / "production-enabled").read_text().strip() == "azure-fenced")
    else:
        require(config["target"] == "hetzner-staging")
    return run["head_sha"]


def download_request(api, run_id, attempt):
    listing = api.json(f"/actions/runs/{run_id}/artifacts?per_page=100")
    require(listing["total_count"] <= 100)
    artifacts = [item for item in listing["artifacts"] if item["name"] == f"hetzner-request-{attempt}"]
    require(len(artifacts) == 1)
    artifact = artifacts[0]
    require(not artifact["expired"] and artifact["size_in_bytes"] <= MAX_ARTIFACT)
    content = api.fetch(f"/actions/artifacts/{int(artifact['id'])}/zip")
    require(artifact["digest"] == "sha256:" + hashlib.sha256(content).hexdigest())
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        require(sorted(archive.namelist()) == ["request.json", "runtime-secrets.json.gpg"])
        require(sum(item.file_size for item in archive.infolist()) <= MAX_ARTIFACT)
        return json.loads(archive.read("request.json")), archive.read("runtime-secrets.json.gpg")


def validate_request(request, config, sha):
    require(request["sha"] == sha and request["target"] == config["target"])
    require(type(request["recovery_point_opt_in"]) is bool)
    for key, repository in (("app_image", "app_repository"), ("search_image", "search_repository")):
        require(re.fullmatch(re.escape(config[repository]) + r"@sha256:[0-9a-f]{64}", request[key]))


def scalar_bundle(value):
    require(type(value) is dict)
    require(all(type(item) in (str, int, float, bool) and
                (type(item) is not float or math.isfinite(item)) for item in value.values()))
    require(all(type(item) is str for key, item in value.items()
                if key == "CRYPTO_SECRET" or re.fullmatch(r"CRYPTO_SECRET_V[1-9]\d*", key)))
    return {key: str(item).lower() if type(item) is bool else str(item) for key, item in value.items()}


def merge_secrets(incoming, current, database, target):
    incoming, current, database = map(scalar_bundle, (incoming, current, database))
    require(set(database) == {"POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"})
    require(database["POSTGRES_HOST"] == "/var/run/postgresql")
    require(database["POSTGRES_USER"] == "tomoribot_runtime")
    require(database["POSTGRES_DB"] == "tomoribot" and database["POSTGRES_PORT"] == "5432")
    require(bool(database["POSTGRES_PASSWORD"]))
    protected = {key: value for key, value in current.items()
                 if key.startswith("CRYPTO_SECRET") or key == "VERTEX_ALLOWED_OWNERS"}
    require(any(value for key, value in protected.items()
                if key == "CRYPTO_SECRET" or re.fullmatch(r"CRYPTO_SECRET_V[1-9]\d*", key)))
    if target == "production":
        require(bool(protected.get("VERTEX_ALLOWED_OWNERS", "").strip()))
    incoming = {key: value for key, value in incoming.items() if not key.startswith("CRYPTO_SECRET")}
    merged = incoming | protected | database
    require(bool(merged.get("DISCORD_TOKEN")))
    require(merged["DISCORD_TOKEN"] == current["DISCORD_TOKEN"])
    if target == "hetzner-staging":
        require(merged.get("TOMORI_SUPPORTER_BILLING_ENABLED", "false") == "false")
    return merged


def execute(run_id, attempt):
    os.umask(0o077)
    STATE.mkdir(mode=0o700, exist_ok=True)
    with (STATE / "request.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        config = json.loads((CONFIG / "config.json").read_text())
        api = GitHub(config["repository"], (CONFIG / "github-token").read_text().strip())
        sha = verify_run(api, config, run_id, attempt)
        request, encrypted = download_request(api, run_id, attempt)
        validate_request(request, config, sha)
        marker = STATE / f"succeeded-{run_id}-{attempt}"
        if marker.exists():
            return
        require(not (STATE / "recovery-required").exists())
        stage = Path(tempfile.mkdtemp(prefix=".request-", dir=STATE))
        try:
            (stage / "runtime-secrets.json.gpg").write_bytes(encrypted)
            with (stage / "incoming.json").open("wb") as output:
                subprocess.run(["gpg", "--batch", "--max-output", str(MAX_ARTIFACT), "--homedir", str(CONFIG / "gnupg"), "--decrypt",
                                str(stage / "runtime-secrets.json.gpg")], stdout=output, stderr=subprocess.DEVNULL, check=True)
            merged = merge_secrets(json.loads((stage / "incoming.json").read_text()),
                                   json.loads(Path("/etc/tomoribot/secrets.json").read_text()),
                                   json.loads(Path("/etc/tomoribot/secrets.db.json").read_text()), config["target"])
            (stage / "secrets.json").write_text(json.dumps(merged))
            (stage / "request.json").write_text(json.dumps(request))
            verify_run(api, config, run_id, attempt)
            with (STATE / "last-deploy.log").open("w") as output:
                subprocess.run(["/etc/tomoribot/deploy.sh", str(stage)], stdout=output, stderr=subprocess.STDOUT, check=True)
            marker.touch(mode=0o600)
        finally:
            shutil.rmtree(stage)


def main():
    require(os.geteuid() == 0)
    os.environ.clear()
    os.environ.update(PATH="/usr/sbin:/usr/bin:/sbin:/bin", HOME="/root", LANG="C.UTF-8")
    if len(sys.argv) == 4 and sys.argv[1] == "--execute":
        try:
            execute(int(sys.argv[2]), int(sys.argv[3]))
        except Exception:
            os.umask(0o077)
            STATE.mkdir(mode=0o700, exist_ok=True)
            with (STATE / "last-request-error.log").open("w") as output:
                traceback.print_exc(file=output)
            raise
        return
    require(len(sys.argv) == 1)
    values = sys.stdin.readline(128).strip()
    require(re.fullmatch(r"[1-9]\d{0,19} [1-9]\d{0,5}", values))
    run_id, attempt = values.split()
    subprocess.run(["systemd-run", "--quiet", "--wait", "--collect", "--unit=tomoribot-deploy",
                    "--property=RuntimeMaxSec=10500", "/usr/local/lib/tomoribot/deploy-request.py",
                    "--execute", run_id, attempt], check=True)
    print("Verified deployment completed.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Deployment failed; inspect the protected host deployment journal and recovery state.", file=sys.stderr)
        sys.exit(1)
