import { describe, expect, it } from "bun:test";
import {
  buildPresetAvatarFilename,
  buildPresetSpriteFilename,
  isSharedPresetAssetReference,
} from "@/utils/storage/avatarStorage";

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

    it("flags shared preset AVATARS (local + URL forms) as protected", () => {
      // Avatars live as a top-level `avatar-{hash}.png` file (no sprites/ subfolder).
      expect(isSharedPresetAssetReference("data/avatars/presets/4/en-US/avatar-abc123.png")).toBe(true);
      expect(isSharedPresetAssetReference("data\\avatars\\presets\\4\\en-US\\avatar-abc123.png")).toBe(true);
      expect(
        isSharedPresetAssetReference("https://storage.googleapis.com/bucket/avatars/presets/4/en-US/avatar-x.png"),
      ).toBe(true);
    });

    it("does NOT flag per-server (deletable) assets", () => {
      // Server-owned sprite, so must remain deletable.
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

  describe("buildPresetAvatarFilename", () => {
    it("is content-addressed and deterministic", () => {
      expect(buildPresetAvatarFilename("abc123def456")).toBe("avatar-abc123def456.png");
      // Different content → different name (so the shared URL changes and fans out).
      expect(buildPresetAvatarFilename("999999999999")).not.toBe(buildPresetAvatarFilename("abc123def456"));
    });
  });
});
