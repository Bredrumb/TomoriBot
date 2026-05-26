import { describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import type { AssembledServerConfig } from "@/types/db/schema";
import { ContextItemTag } from "@/types/misc/context";
import { buildPromptContextItems } from "@/utils/text/context/templates";

describe("public persona attributes context", () => {
  it("resolves {bot} against the public attribute owner", async () => {
    const items = await buildPromptContextItems({
      client: {} as Client,
      guildId: "_rt_guild",
      botName: "Temari",
      tomoriAttributes: ["{bot}'s private attribute"],
      publicPersonaAttributes: [
        {
          personaId: 1,
          personaName: "Rose",
          attributes: ["{bot}'s Appearance: red hoodie"],
        },
      ],
      tomoriConfig: {
        system_prompt: "",
        personal_memories_enabled: true,
      } as unknown as AssembledServerConfig,
      personaPrompt: null,
      isUserImpersonation: false,
      impersonatedIdentityName: null,
      impersonatedUserPrompt: null,
      suppressDefaultSystemPrompt: true,
      snapshot: undefined,
      toolPromptMacroResolver: {
        expand: async (text) => text,
      },
      convertMentions: async (text, _client, _guildId, _userName, botName) => text.replaceAll("{bot}", botName),
    });

    const publicAttributeItem = items.find(
      (item) => item.metadataTag === ContextItemTag.SYSTEM_PUBLIC_PERSONA_ATTRIBUTES,
    );

    expect(publicAttributeItem?.parts[0]?.type).toBe("text");
    expect(publicAttributeItem?.parts[0]?.type === "text" ? publicAttributeItem.parts[0].text : "").toContain(
      "Rose's Appearance: red hoodie",
    );
    expect(publicAttributeItem?.parts[0]?.type === "text" ? publicAttributeItem.parts[0].text : "").not.toContain(
      "Temari's Appearance",
    );
  });
});
