import { describe, expect, it, mock } from "bun:test";
import { loadIdentityCharacterReference } from "@/tools/functionCalls/generateImageTool";
import { PrivacyLevel } from "@/types/db/schema";
import type { ResolvedAvatarData } from "@/utils/discord/avatarResolver";
import { createPersona, createUserRow } from "../../helpers/fixtures";

const GUILD_ID = "100000000000000001";
const USER_DISC_ID = "200000000000000002";

function personaAvatar(personaId: number): ResolvedAvatarData {
  return { sourceType: "persona", username: "Mirri", avatarUrl: "https://cdn.invalid/p.png", personaId };
}

function userAvatar(): ResolvedAvatarData {
  return { sourceType: "user", username: "Juno", avatarUrl: "https://cdn.invalid/u.png", userDiscId: USER_DISC_ID };
}

function dependencies(overrides: { personaRef?: string | null; userRef?: string | null; privacy?: PrivacyLevel }) {
  const loadReference = mock(async (url: string) => `base64:${url}`);
  return {
    loadReference,
    deps: {
      loadPersonas: async () => [createPersona({ persona_id: 7, char_ref_url: overrides.personaRef ?? null })],
      loadUser: async () =>
        createUserRow({
          user_disc_id: USER_DISC_ID,
          char_ref_url: overrides.userRef ?? null,
          privacy_level: overrides.privacy ?? PrivacyLevel.MINIMAL,
        }),
      loadReference,
    },
  };
}

describe("generate_image identity character references", () => {
  it("uses a persona's saved reference from that persona's own storage", async () => {
    const { deps, loadReference } = dependencies({ personaRef: "data/charreferences/personas/7/a.png" });

    await expect(loadIdentityCharacterReference(personaAvatar(7), GUILD_ID, deps)).resolves.toBe(
      "base64:data/charreferences/personas/7/a.png",
    );
    expect(loadReference).toHaveBeenCalledWith("data/charreferences/personas/7/a.png", "personas", 7);
  });

  it("falls back to the avatar when the persona has no saved reference", async () => {
    const { deps, loadReference } = dependencies({ personaRef: null });

    await expect(loadIdentityCharacterReference(personaAvatar(7), GUILD_ID, deps)).resolves.toBeNull();
    expect(loadReference).not.toHaveBeenCalled();
  });

  it("uses a user's saved reference keyed by their Discord ID", async () => {
    const { deps, loadReference } = dependencies({ userRef: "data/charreferences/users/200000000000000002/a.png" });

    await expect(loadIdentityCharacterReference(userAvatar(), GUILD_ID, deps)).resolves.not.toBeNull();
    expect(loadReference).toHaveBeenCalledWith(
      "data/charreferences/users/200000000000000002/a.png",
      "users",
      USER_DISC_ID,
    );
  });

  it("keeps a Full-privacy user's upload out of the generation", async () => {
    const { deps, loadReference } = dependencies({
      userRef: "data/charreferences/users/200000000000000002/a.png",
      privacy: PrivacyLevel.FULL,
    });

    await expect(loadIdentityCharacterReference(userAvatar(), GUILD_ID, deps)).resolves.toBeNull();
    expect(loadReference).not.toHaveBeenCalled();
  });
});
