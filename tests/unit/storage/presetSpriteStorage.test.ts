import { describe, expect, it } from "bun:test";
import {
  buildPresetAvatarFilename,
  buildPresetAvatarRelativeKey,
  buildPresetSpriteFilename,
  buildPresetSpriteRelativeKey,
  isSharedPresetAssetReference,
} from "@/utils/storage/avatarStorage";

describe("preset sprite storage helpers", () => {
  describe("isSharedPresetAssetReference (delete guard)", () => {
    it("flags shared preset images (local + URL forms) as protected", () => {
      expect(isSharedPresetAssetReference("data/avatars/presets/4/sprites/mad-abc123.png")).toBe(true);
      expect(isSharedPresetAssetReference("data\\avatars\\presets\\4\\sprites\\mad-abc123.png")).toBe(true);
      expect(
        isSharedPresetAssetReference("https://storage.googleapis.com/bucket/avatars/presets/4/sprites/mad-x.png"),
      ).toBe(true);
    });

    it("flags shared preset AVATARS (local + URL forms) as protected", () => {
      expect(isSharedPresetAssetReference("data/avatars/presets/4/avatar-abc123.png")).toBe(true);
      expect(isSharedPresetAssetReference("data\\avatars\\presets\\4\\avatar-abc123.png")).toBe(true);
      expect(isSharedPresetAssetReference("https://storage.googleapis.com/bucket/avatars/presets/4/avatar-x.png")).toBe(
        true,
      );
    });

    it("still protects the retired per-language layout, which survives in stored rows", () => {
      // Rows written before the language segment was dropped stay valid until re-seed, so dropping this match
      // would expose shared images to delete.
      expect(isSharedPresetAssetReference("data/avatars/presets/4/en-US/sprites/mad-abc123.png")).toBe(true);
      expect(isSharedPresetAssetReference("data/avatars/presets/4/en-US/avatar-abc123.png")).toBe(true);
      expect(
        isSharedPresetAssetReference("https://storage.googleapis.com/bucket/avatars/presets/4/ja/sprites/mad-x.png"),
      ).toBe(true);
      expect(
        isSharedPresetAssetReference("https://storage.googleapis.com/bucket/avatars/presets/4/ja/avatar-x.png"),
      ).toBe(true);
    });

    it("does NOT flag per-server (deletable) assets", () => {
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
      expect(filename).toBe("very_mad-abc123def456.png");
      expect(buildPresetSpriteFilename("very mad", "abc123def456")).toBe(filename);
      expect(buildPresetSpriteFilename("very mad", "999999999999")).not.toBe(filename);
    });
  });

  describe("buildPresetAvatarFilename", () => {
    it("is content-addressed and deterministic", () => {
      expect(buildPresetAvatarFilename("abc123def456")).toBe("avatar-abc123def456.png");
      expect(buildPresetAvatarFilename("999999999999")).not.toBe(buildPresetAvatarFilename("abc123def456"));
    });
  });

  // Every locale variant shares the same avatarPath and sprite files, so a language segment duplicates identical
  // assets on disk.
  describe("shared preset keys carry no language segment", () => {
    it("addresses a sprite by lineage and content alone", () => {
      expect(buildPresetSpriteRelativeKey({ lineageId: 4, spriteKey: "explaining", contentHash: "491584cf1ebe" })).toBe(
        "presets/4/sprites/explaining-491584cf1ebe.png",
      );
    });

    it("addresses an avatar by lineage and content alone", () => {
      expect(buildPresetAvatarRelativeKey({ lineageId: 4, contentHash: "88160f15bd65" })).toBe(
        "presets/4/avatar-88160f15bd65.png",
      );
    });

    it("keeps a changed image on a distinct key so pointer personas pick it up", () => {
      const before = buildPresetAvatarRelativeKey({ lineageId: 4, contentHash: "88160f15bd65" });
      expect(buildPresetAvatarRelativeKey({ lineageId: 4, contentHash: "999999999999" })).not.toBe(before);
    });

    it("keeps distinct lineages apart", () => {
      const four = buildPresetSpriteRelativeKey({ lineageId: 4, spriteKey: "happy", contentHash: "aaaaaaaaaaaa" });
      const other = buildPresetSpriteRelativeKey({ lineageId: 3585, spriteKey: "happy", contentHash: "aaaaaaaaaaaa" });
      expect(four).not.toBe(other);
    });
  });
});
