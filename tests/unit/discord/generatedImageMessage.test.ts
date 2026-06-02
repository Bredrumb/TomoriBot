import { beforeAll, describe, expect, test } from "bun:test";
import { ComponentType, MessageFlags } from "discord.js";
import { buildGeneratedImageComponentsV2Payload } from "@/utils/discord/generatedImageMessage";
import { initializeLocalizer } from "@/utils/text/localizer";

describe("buildGeneratedImageComponentsV2Payload", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  test("builds a media gallery followed by localized timing subtext", () => {
    const payload = buildGeneratedImageComponentsV2Payload("generated_123.png", 4242, "en-US");

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.components).toEqual([
      {
        type: ComponentType.MediaGallery,
        items: [
          {
            media: {
              url: "attachment://generated_123.png",
            },
          },
        ],
      },
      {
        type: ComponentType.TextDisplay,
        content: "-# Generated after 4.2 seconds",
      },
    ]);
  });

  test("appends a referenced-identities subtext line when avatars were used", () => {
    const payload = buildGeneratedImageComponentsV2Payload("generated_123.png", 4242, "en-US", ["Aphel", "Miku"]);

    const textComponent = payload.components.find((component) => component.type === ComponentType.TextDisplay) as {
      content: string;
    };
    const lines = textComponent.content.split("\n");

    // Timing stays on the first line; referenced users render on their own line.
    expect(lines[0]).toContain("Generated after 4.2 seconds");
    expect(lines[1]).toBe("-# Referenced: Aphel, Miku");
  });
});
