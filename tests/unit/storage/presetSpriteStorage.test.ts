import { describe, expect, it } from "bun:test";
import { buildPresetSpriteFilename, isSharedPresetAssetReference } from "@/utils/storage/avatarStorage";

describe("preset sprite storage helpers", () => {
  describe("isSharedPresetAssetReference (delete guard)", () => {
    it("flags shared preset images (local + URL forms) as protected", () => {
      // Local non-production path under the immutable presets/ prefix.
      expect(isSharedPresetAssetReference("data/avatars/presets/4/en-US/sprites/mad-abc123.png")).toBe(true);
      // Windows-style separators normalize to the same shared path.
      expect(isSharedPresetAssetReference("data\\avatars\\presets\\4\\en-US\\sprites\\mad-abc123.png")).toBe(true);
      // Production public URL form.
      expect(
        isSharedPresetAssetReference("https://storage.googleapis.com/bucket/avatars/presets/4/en-US/sprites/mad-x.png"),
      ).toBe(true);
    });

    it("does NOT flag per-server (deletable) assets", () => {
      // Server-owned sprite — must remain deletable.
      expect(isSharedPresetAssetReference("data/avatars/servers/123/personas/5/sprites/1700000000000.png")).toBe(false);
      expect(
        isSharedPresetAssetReference("https://storage.googleapis.com/bucket/avatars/servers/123/personas/5/1.png"),
      ).toBe(false);
      expect(isSharedPresetAssetReference(null)).toBe(false);
      expect(isSharedPresetAssetReference(undefined)).toBe(false);
      expect(isSharedPresetAssetReference("")).toBe(false);
    });
  });

  describe("buildPresetSpriteFilename", () => {
    it("is path-safe, content-addressed, and deterministic", () => {
      const filename = buildPresetSpriteFilename("very mad", "abc123def456");
      // Spaces become underscores; the content hash is preserved; .png suffix.
      expect(filename).toBe("very_mad-abc123def456.png");
      // Same inputs always produce the same name (so a re-seed is a no-op).
      expect(buildPresetSpriteFilename("very mad", "abc123def456")).toBe(filename);
      // Different content → different name (so the URL changes and fans out).
      expect(buildPresetSpriteFilename("very mad", "999999999999")).not.toBe(filename);
    });
  });
});
