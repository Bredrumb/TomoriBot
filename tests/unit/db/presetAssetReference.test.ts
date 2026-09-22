import { describe, expect, it } from "bun:test";
import { resolveSharedPresetAssetReference } from "@/db/seed/catalog/presetAssetReference";

const KEY = "presets/4/avatar-abc123.png";

describe("resolveSharedPresetAssetReference", () => {
  it("uploads an asset once per run and reuses the reference for later locale variants", async () => {
    const uploadedThisRun = new Map<string, string>();
    let uploads = 0;
    const upload = async () => {
      uploads += 1;
      return `https://storage.example.test/${KEY}`;
    };

    const first = await resolveSharedPresetAssetReference({
      expectedKey: KEY,
      existingReference: null,
      uploadedThisRun,
      upload,
      logFailure: () => {},
    });
    const second = await resolveSharedPresetAssetReference({
      expectedKey: KEY,
      existingReference: null,
      uploadedThisRun,
      upload,
      logFailure: () => {},
    });

    expect(first).toBe(`https://storage.example.test/${KEY}`);
    expect(second).toBe(first);
    expect(uploads).toBe(1);
  });

  it("reuses a stored reference that already ends with the expected key, without uploading", async () => {
    let uploads = 0;
    const stored = `https://storage.example.test/${KEY}`;

    const resolved = await resolveSharedPresetAssetReference({
      expectedKey: KEY,
      existingReference: stored,
      uploadedThisRun: new Map(),
      upload: async () => {
        uploads += 1;
        return stored;
      },
      logFailure: () => {},
    });

    expect(resolved).toBe(stored);
    expect(uploads).toBe(0);
  });

  it("re-uploads when the stored reference points at a different key", async () => {
    // A changed image resolves to a new content-addressed key, and the stale row must be replaced
    // rather than trusted.
    let uploads = 0;
    const resolved = await resolveSharedPresetAssetReference({
      expectedKey: KEY,
      existingReference: "https://storage.example.test/presets/4/stale/avatar-999999999999.png",
      uploadedThisRun: new Map(),
      upload: async () => {
        uploads += 1;
        return `https://storage.example.test/${KEY}`;
      },
      logFailure: () => {},
    });

    expect(resolved).toBe(`https://storage.example.test/${KEY}`);
    expect(uploads).toBe(1);
  });

  it("reports the failure and returns null when the upload yields no reference", async () => {
    const failures: unknown[] = [];
    const resolved = await resolveSharedPresetAssetReference({
      expectedKey: KEY,
      existingReference: null,
      uploadedThisRun: new Map(),
      upload: async () => null,
      logFailure: (error) => failures.push(error),
    });

    expect(resolved).toBeNull();
    expect(failures).toEqual([undefined]);
  });

  it("does not cache a failed upload, so a later locale variant retries it", async () => {
    const uploadedThisRun = new Map<string, string>();
    let uploads = 0;
    const upload = async () => {
      uploads += 1;
      return uploads === 1 ? null : `https://storage.example.test/${KEY}`;
    };

    const failed = await resolveSharedPresetAssetReference({
      expectedKey: KEY,
      existingReference: null,
      uploadedThisRun,
      upload,
      logFailure: () => {},
    });
    const retried = await resolveSharedPresetAssetReference({
      expectedKey: KEY,
      existingReference: null,
      uploadedThisRun,
      upload,
      logFailure: () => {},
    });

    expect(failed).toBeNull();
    expect(retried).toBe(`https://storage.example.test/${KEY}`);
    expect(uploads).toBe(2);
  });
});
