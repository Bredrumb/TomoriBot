import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export interface PythonCommand {
  command: string;
  args: string[];
  displayName: string;
}

export interface InstallPythonServerOptions {
  serverDir: string;
  label: string;
  python?: PythonCommand;
}

export type InstallPythonServerResult = "already-installed" | "installed";

const ROOT = process.cwd();
const IS_WINDOWS = process.platform === "win32";

export const VENV_BIN_DIR = IS_WINDOWS ? "Scripts" : "bin";
export const VENV_PYTHON = IS_WINDOWS ? "python.exe" : "python3";

async function commandSucceeds(command: string, args: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

async function runInherited(command: string, args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${exitCode}`);
  }
}

export function resolvePythonExe(venvRelPath: string): string {
  return join(ROOT, venvRelPath, VENV_BIN_DIR, VENV_PYTHON);
}

export function resolvePythonExeFromVenvDir(venvDir: string): string {
  return join(venvDir, VENV_BIN_DIR, VENV_PYTHON);
}

export async function detectPython(): Promise<PythonCommand | undefined> {
  const candidates: PythonCommand[] =
    process.platform === "win32"
      ? [
          { command: "python", args: [], displayName: "python" },
          { command: "py", args: ["-3"], displayName: "py -3" },
          { command: "python3", args: [], displayName: "python3" },
        ]
      : [
          { command: "python3", args: [], displayName: "python3" },
          { command: "python", args: [], displayName: "python" },
        ];

  for (const candidate of candidates) {
    if (await commandSucceeds(candidate.command, [...candidate.args, "--version"])) {
      return candidate;
    }
  }

  return undefined;
}

function relativeToRoot(path: string): string {
  return relative(ROOT, path).replace(/\\/g, "/");
}

function resolveInstallScript(serverDir: string): { command: string; args: string[] } | undefined {
  if (process.platform === "win32") {
    const ps1Path = join(serverDir, "install-irodori.ps1");
    if (existsSync(ps1Path)) {
      return {
        command: "powershell",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1Path],
      };
    }
  }

  const shPath = join(serverDir, "install-irodori.sh");
  if (existsSync(shPath)) {
    return {
      command: "sh",
      args: [shPath],
    };
  }

  return undefined;
}

export async function installPythonServer(options: InstallPythonServerOptions): Promise<InstallPythonServerResult> {
  const serverDir = resolve(options.serverDir);
  const venvDir = join(serverDir, ".venv");
  const pythonExe = resolvePythonExeFromVenvDir(venvDir);
  if (existsSync(pythonExe)) {
    return "already-installed";
  }

  const installScript = resolveInstallScript(serverDir);
  if (installScript) {
    await runInherited(installScript.command, installScript.args, serverDir);
    return "installed";
  }

  const requirementsPath = join(serverDir, "requirements.txt");
  if (!existsSync(requirementsPath)) {
    throw new Error(`${options.label} has no requirements.txt at ${relativeToRoot(requirementsPath)}.`);
  }

  const python = options.python ?? (await detectPython());
  if (!python) {
    throw new Error("Python 3 was not found in PATH.");
  }

  await runInherited(python.command, [...python.args, "-m", "venv", ".venv"], serverDir);
  await runInherited(pythonExe, ["-m", "pip", "install", "--upgrade", "pip"], serverDir);
  await runInherited(pythonExe, ["-m", "pip", "install", "-r", requirementsPath], serverDir);

  return "installed";
}
