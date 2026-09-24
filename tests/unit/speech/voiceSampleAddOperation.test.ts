import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  addVoiceSample,
  SPEECH_SAMPLE_MAX_DURATION_SECS,
  SPEECH_SAMPLE_MAX_MB,
  type VoiceSampleAddDependencies,
} from "@/utils/speech/voiceSampleAddOperation";

const MODULE_PATH = resolve(import.meta.dir, "..", "..", "..", "src", "utils", "speech", "voiceSampleAddOperation.ts");

function makeDeps(durationSecs: number): { deps: VoiceSampleAddDependencies; writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    deps: {
      safeDownload: async () => ({ success: true, buffer: Buffer.from([0x52, 0x49, 0x46, 0x46]) }),
      parseDuration: async () => durationSecs,
      normalizeToWav: async () => Buffer.from("RIFF0000WAVE"),
      insertVoiceSample: async () => {
        writes.push("insert");
        return 7;
      },
      storeVoiceSample: async () => {
        writes.push("store");
        return "data/voice-samples/7.wav";
      },
      updateVoiceSamplePath: async () => {
        writes.push("update-path");
      },
      deleteVoiceSample: async () => {
        writes.push("delete");
      },
    },
  };
}

function upload(size: number) {
  return {
    url: "https://cdn.example.test/clip.wav",
    filename: "clip.wav",
    contentType: "audio/wav",
    size,
  };
}

describe("voice sample duration cap", () => {
  it("defaults to 130 seconds", () => {
    expect(SPEECH_SAMPLE_MAX_DURATION_SECS).toBe(130);
  });

  it("accepts a clip exactly at the cap", async () => {
    const { deps } = makeDeps(SPEECH_SAMPLE_MAX_DURATION_SECS);

    const result = await addVoiceSample(
      { serverId: 1, upload: upload(1024), sampleName: "Mirri", refText: null },
      deps,
    );

    expect(result.status).toBe("success");
  });

  it("rejects a clip one second past the cap without writing anything", async () => {
    const { deps, writes } = makeDeps(SPEECH_SAMPLE_MAX_DURATION_SECS + 1);

    const result = await addVoiceSample(
      { serverId: 1, upload: upload(1024), sampleName: "Mirri", refText: null },
      deps,
    );

    expect(result).toEqual({ status: "too-long", limitSecs: SPEECH_SAMPLE_MAX_DURATION_SECS });
    expect(writes).toEqual([]);
  });

  it("still enforces the upload size ceiling before parsing duration", async () => {
    const { deps } = makeDeps(10);

    const result = await addVoiceSample(
      { serverId: 1, upload: upload(SPEECH_SAMPLE_MAX_MB * 1024 * 1024 + 1), sampleName: "Mirri", refText: null },
      deps,
    );

    expect(result).toEqual({ status: "too-large" });
  });
});

/**
 * The constant is read once at module load, so an in-process assignment cannot exercise the
 * override. A child process gets a real module load with the variable already in place.
 */
describe("voice sample duration cap override", () => {
  async function probe(rawValue: string): Promise<number | null> {
    const workspace = await mkdtemp(join(tmpdir(), "tomori-sample-cap-"));
    const script = join(workspace, "probe.ts");
    await writeFile(
      script,
      [
        `import { SPEECH_SAMPLE_MAX_DURATION_SECS } from ${JSON.stringify(pathToFileURL(MODULE_PATH).href)};`,
        'console.log("__CAP__" + JSON.stringify(SPEECH_SAMPLE_MAX_DURATION_SECS));',
      ].join("\n"),
    );

    try {
      const result = Bun.spawnSync({
        cmd: ["bun", "run", script],
        cwd: workspace,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, SPEECH_SAMPLE_MAX_DURATION_SECS: rawValue },
      });
      const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
      const marker = output.split("__CAP__")[1];
      if (!marker) throw new Error(`Duration cap probe produced no result:\n${output}`);
      return JSON.parse(marker.split("\n")[0]) as number | null;
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  it("honours a whole-number override", async () => {
    expect(await probe("45")).toBe(45);
  });

  it("falls back to the default when the override is not a usable number", async () => {
    expect(await probe("not-a-number")).toBe(130);
    expect(await probe("-5")).toBe(130);
  });
});
