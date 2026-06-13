import { describe, expect, it } from "bun:test";
import type { PersonaSpriteRow } from "@/types/db/schema";
import { buildSpriteArchive, readSpriteArchive, type SpriteArchiveReadLimits } from "@/utils/persona/spriteArchive";

const LIMITS: SpriteArchiveReadLimits = {
  maxEntries: 50,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
};

function spriteRow(name: string, instructions: string, isIdentity: boolean): PersonaSpriteRow {
  return {
    sprite_id: 1,
    persona_id: 7,
    sprite_name: name,
    sprite_key: name,
    avatar_url: `data/avatars/servers/test/personas/7/sprites/${name}.png`,
    usage_instructions: instructions,
    is_identity: isIdentity,
  };
}

describe("persona sprite archive", () => {
  it("round-trips sprite metadata and image bytes through build -> read", async () => {
    const built = await buildSpriteArchive({
      personaNickname: "Tomori",
      personaId: 7,
      entries: [
        { sprite: spriteRow("mad", "Use when angry.", true), pngBuffer: Buffer.from("image-mad") },
        { sprite: spriteRow("sad", "Use when upset.", false), pngBuffer: Buffer.from("image-sad") },
      ],
    });

    expect(built.spriteCount).toBe(2);

    const result = await readSpriteArchive(built.buffer, LIMITS);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.sourceNickname).toBe("Tomori");
    expect(result.entries).toHaveLength(2);

    const mad = result.entries.find((entry) => entry.meta.sprite_key === "mad");
    expect(mad?.meta.sprite_name).toBe("mad");
    expect(mad?.meta.usage_instructions).toBe("Use when angry.");
    expect(mad?.meta.is_identity).toBe(true);
    expect(mad?.pngBuffer.toString()).toBe("image-mad");

    const sad = result.entries.find((entry) => entry.meta.sprite_key === "sad");
    expect(sad?.meta.is_identity).toBe(false);
    expect(sad?.pngBuffer.toString()).toBe("image-sad");
  });

  it("rejects a buffer that is not a valid zip", async () => {
    const result = await readSpriteArchive(Buffer.from("this is definitely not a zip file"), LIMITS);
    expect(result).toEqual({ ok: false, reason: "invalid_zip" });
  });

  it("rejects an archive that exceeds the entry-count limit", async () => {
    const built = await buildSpriteArchive({
      personaNickname: "Tomori",
      personaId: 7,
      entries: [
        { sprite: spriteRow("mad", "", false), pngBuffer: Buffer.from("a") },
        { sprite: spriteRow("sad", "", false), pngBuffer: Buffer.from("b") },
      ],
    });

    const result = await readSpriteArchive(built.buffer, { ...LIMITS, maxEntries: 1 });
    expect(result).toEqual({ ok: false, reason: "too_many_entries" });
  });

  it("rejects an image that exceeds the per-file size limit", async () => {
    const built = await buildSpriteArchive({
      personaNickname: "Tomori",
      personaId: 7,
      entries: [{ sprite: spriteRow("mad", "", false), pngBuffer: Buffer.alloc(2048, 1) }],
    });

    const result = await readSpriteArchive(built.buffer, { ...LIMITS, maxFileBytes: 1024 });
    expect(result).toEqual({ ok: false, reason: "file_too_large" });
  });
});
