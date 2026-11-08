#!/usr/local/bin/python3
import json
import os
from pathlib import Path
import sys


host = Path("/tmp/fake-host.json")
state = json.loads(host.read_text())
command = Path(sys.argv[0]).name
args = sys.argv[1:]
state["commands"].append([command, *args])
mode = state["mode"]
output = ""
code = 0

if command == "systemctl":
    action, *units = args
    if action == "is-active":
        code = 0 if units[-1] in state["active"] else 3
    elif action == "is-enabled":
        code = 0 if units[-1] in state["enabled"] else 1
    elif action in ("stop", "disable"):
        state["active"] = [unit for unit in state["active"] if unit not in units]
        if action == "disable":
            state["enabled"] = [unit for unit in state["enabled"] if unit not in units]
    elif action == "enable":
        state["enabled"].extend(units)
    elif action == "start" and units == ["tomoribot-backup.service"]:
        if mode == "backup-failure":
            code = 1
        else:
            import hashlib
            directory = Path("/var/backups/tomoribot")
            directory.mkdir(parents=True, exist_ok=True)
            content = b"encrypted-fixture"
            name = "tomoribot-20000101T000000Z.tar.gpg"
            (directory / name).write_bytes(content)
            (directory / name.replace(".tar.gpg", ".sha256")).write_text(hashlib.sha256(content).hexdigest() + "  " + name + "\n")
    elif action == "start":
        state["active"].extend(units)
    elif action == "show":
        output = ("activating" if mode == "backup-running" else "inactive") if "ActiveState" in args else "success"
elif command == "docker":
    if args[0] == "inspect":
        template = args[2]
        if template == "{{.State.Running}}":
            output = str(state["app"]).lower()
        elif template == "{{.Image}}":
            output = "sha256:fixture"
        elif template == "{{.Config.User}}":
            output = "1001:1001"
        elif template == "{{.State.StartedAt}}":
            output = "fixture-start"
        else:
            output = "fixture-start:0:false"
    elif args[:2] == ["image", "inspect"]:
        output = "arm64" if args[3] == "{{.Architecture}}" else "sha256:fixture"
    elif args[0] == "ps":
        output = "app-id" if state["app"] else ""
    elif args[0] == "compose":
        if "ps" in args:
            output = "app-id\ntunnel-id" if "-aq" in args else ("tunnel-id" if state["tunnel"] else "")
        elif "stop" in args:
            state["app"] = state["tunnel"] = False
        elif "up" in args:
            if args[-1] == "tomoribot":
                state["app"] = True
            elif args[-1] == "cloudflared":
                if mode == "tunnel-failure" and state["migrated"]:
                    code = 1
                else:
                    state["tunnel"] = True
    elif args[0] == "run":
        if any("checkPendingMigrations.ts" in arg for arg in args):
            code = 1 if mode == "gate-failure" else 0
        elif "src/db/initializeCli.ts" in args:
            state["migrated"] = True
            code = 1 if mode == "migration-failure" else 0
        elif "audit-keys" in args:
            code = 1 if mode == "audit-failure" else 0
elif command == "curl":
    shards = [{"id": index, "ready": True, "ping": 1} for index in range(4)]
    if mode == "missing-shard" and state["migrated"]:
        shards.pop()
    output = json.dumps({"status": "healthy", "discord": {"connected": True, "shardCount": 4, "shards": shards}})
elif command in ("timeout", "base64"):
    code = 1

host.write_text(json.dumps(state))
if output:
    print(output)
sys.exit(code)
