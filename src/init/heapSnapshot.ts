import { log } from "@/utils/misc/logger";
import { lstatSync, mkdirSync, writeFileSync } from "node:fs";

// "v8" format is passed because it returns a string directly, whereas Bun's default object shape requires
// JSON.stringify and doubles peak memory.
type SnapshotGenerator = () => string;

const generateSnapshot: SnapshotGenerator = () => Bun.generateHeapSnapshot("v8");

// Handler stays opt-in for writable mounts because snapshots spike memory, and generate is injectable so tests avoid
// multi-second stop-the-world pauses.
export function registerHeapSnapshotHandler(
  dir = process.env.HEAP_SNAPSHOT_DIR,
  generate: SnapshotGenerator = generateSnapshot,
): void {
  if (!dir) return;

  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const destination = lstatSync(dir);
    if (
      !destination.isDirectory() ||
      destination.isSymbolicLink() ||
      (process.platform !== "win32" && ((destination.mode & 0o077) !== 0 || destination.uid !== process.getuid?.()))
    ) {
      throw new Error("Diagnostic directory must be owned by the bot user and accessible only to that user.");
    }
  } catch {
    log.warn("Heap snapshot handler disabled: configure a private diagnostic directory owned by the bot user.");
    return;
  }

  let inProgress = false;

  process.on("SIGUSR2", () => {
    // A second signal mid-serialization would double the peak allocation, which is the
    // one thing this must never do on a host already short of memory.
    if (inProgress) return;

    inProgress = true;
    void writeHeapSnapshot(dir, generate).finally(() => {
      inProgress = false;
    });
  });

  log.info(`Heap snapshot handler armed: SIGUSR2 writes to ${dir}`);
}

// Snapshot cost uses log.metric rather than log.info because production discards logs below level 50.
async function writeHeapSnapshot(dir: string, generate: SnapshotGenerator): Promise<void> {
  const startedAt = Date.now();
  const heapBeforeMb = process.memoryUsage().heapUsed / 1048576;
  const path = `${dir}/heap-${new Date().toISOString().replace(/[:.]/g, "-")}.heapsnapshot`;

  try {
    const snapshot = generate();
    // Exclusive creation prevents reuse of a readable file or following a pre-existing symlink.
    writeFileSync(path, snapshot, { mode: 0o600, flag: "wx" });
    const bytes = Buffer.byteLength(snapshot);

    log.metric("heap_snapshot", {
      path,
      bytes,
      heap_used_mb_before: Math.round(heapBeforeMb * 100) / 100,
      heap_used_mb_after: Math.round((process.memoryUsage().heapUsed / 1048576) * 100) / 100,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    await log.error("Heap snapshot failed", error);
  }
}
