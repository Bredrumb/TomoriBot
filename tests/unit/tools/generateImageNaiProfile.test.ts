import { describe, expect, it, spyOn } from "bun:test";
import { loadUserNaiProfileByDiscordId } from "@/tools/functionCalls/generateImageNaiTool";
import { PrivacyLevel, type UserRow } from "@/types/db/schema";
import { userRepository } from "@/utils/db/repositories";

const USER_DISC_ID = "12345678901234567";

function createUserRow(): UserRow {
  return {
    user_id: 1,
    user_disc_id: USER_DISC_ID,
    user_nickname: "Profile User",
    language_pref: "en-US",
    registration_locale: null,
    privacy_level: PrivacyLevel.MINIMAL,
    personal_memories: [],
    physical_appearance_tags: ["silver hair", "green eyes"],
    nai_char_ref_url: "https://example.invalid/profile.png",
    impersonation_prompt: null,
    shortterm_cache_crossserver_opt_in: false,
    personal_dtm: "follow",
    personal_deliberate_tool_mode: "follow",
    timezone_offset: null,
  };
}

describe("NovelAI user profile loading", () => {
  it("uses the assembled UserRepository row", async () => {
    const loadUser = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(createUserRow());

    try {
      await expect(loadUserNaiProfileByDiscordId(USER_DISC_ID)).resolves.toEqual({
        tags: ["silver hair", "green eyes"],
        refUrl: "https://example.invalid/profile.png",
      });
      expect(loadUser).toHaveBeenCalledWith(USER_DISC_ID);
    } finally {
      loadUser.mockRestore();
    }
  });

  it("returns null when the user does not exist", async () => {
    const loadUser = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(null);

    try {
      await expect(loadUserNaiProfileByDiscordId(USER_DISC_ID)).resolves.toBeNull();
    } finally {
      loadUser.mockRestore();
    }
  });
});
