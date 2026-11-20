import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { PersonaSpriteRow } from "@/types/db/schema";
import { personaSpriteRepository } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { removePresetSpritesAfterAvatarChange } from "@/utils/persona/avatarChangeSpriteCleanup";

const USER_SPRITE: PersonaSpriteRow = {
  sprite_id: 1,
  persona_id: 5,
  sprite_name: "Smug",
  sprite_key: "smug",
  avatar_url: "data/avatars/servers/server/personas/5/sprites/smug.png",
  usage_instructions: "",
  is_identity: false,
};

const PRESET_SPRITE: PersonaSpriteRow = {
  ...USER_SPRITE,
  sprite_id: 2,
  sprite_name: "Embarrassed",
  sprite_key: "embarrassed",
  avatar_url: "data/avatars/presets/100/en-US/sprites/embarrassed.png",
};

const restoreSpies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  for (const spy of restoreSpies.splice(0)) spy.mockRestore();
});

function spyOnSpriteRepository<K extends keyof typeof personaSpriteRepository>(method: K) {
  const spy = spyOn(personaSpriteRepository, method);
  restoreSpies.push(spy);
  return spy;
}

describe("preset sprite cleanup after an avatar change", () => {
  it("removes only sprites that reference shared preset images", async () => {
    spyOnSpriteRepository("listForPersona").mockResolvedValue([USER_SPRITE, PRESET_SPRITE]);
    const deleteSpy = spyOnSpriteRepository("deleteSpritesByKeys").mockResolvedValue([PRESET_SPRITE]);

    const removed = await removePresetSpritesAfterAvatarChange(USER_SPRITE.persona_id, "server");

    expect(deleteSpy).toHaveBeenCalledWith(USER_SPRITE.persona_id, [PRESET_SPRITE.sprite_key]);
    expect(removed).toBe(1);
  });

  it("reports zero when the persona has only user-uploaded sprites", async () => {
    spyOnSpriteRepository("listForPersona").mockResolvedValue([USER_SPRITE]);
    const deleteSpy = spyOnSpriteRepository("deleteSpritesByKeys").mockResolvedValue([]);

    const removed = await removePresetSpritesAfterAvatarChange(USER_SPRITE.persona_id, "server");

    expect(deleteSpy).toHaveBeenCalledWith(USER_SPRITE.persona_id, []);
    expect(removed).toBe(0);
  });

  it("swallows a sprite read failure because the avatar write already committed", async () => {
    spyOnSpriteRepository("listForPersona").mockRejectedValue(new Error("sprite read unavailable"));
    const deleteSpy = spyOnSpriteRepository("deleteSpritesByKeys");
    const logSpy = spyOn(log, "error").mockImplementation(async () => {});
    restoreSpies.push(logSpy);

    const removed = await removePresetSpritesAfterAvatarChange(USER_SPRITE.persona_id, "server");

    expect(removed).toBe(0);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });
});
