import { describe, expect, it } from "bun:test";
import type { ButtonInteraction, ChatInputCommandInteraction, InteractionEditReplyOptions, Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { replyPaginatedPersonaChoicesV2, type AvatarSessionCache } from "@/utils/discord/ui/interactionCore";

interface PickerHarness {
  interaction: ChatInputCommandInteraction;
  edits: InteractionEditReplyOptions[];
  deferredButtons: string[];
}

function makePersona(): TomoriState {
  return {
    persona_id: 1,
    persona_nickname: "Local avatar persona",
    persona_prompt: "Prompt",
    attribute_list: [],
    is_alter: true,
    webhook_avatar_url: "avatars/local.png",
  } as unknown as TomoriState;
}

function makeHarness(outcome: "cancel" | "timeout"): PickerHarness {
  const edits: InteractionEditReplyOptions[] = [];
  const deferredButtons: string[] = [];
  const message = {
    id: "canonical-picker-message",
    awaitMessageComponent: async () => {
      if (outcome === "timeout") return Promise.reject("time");
      return {
        id: "cancel-button",
        customId: "persona_cancel",
        user: { id: "user-1" },
        deferUpdate: async () => {
          deferredButtons.push("cancel-button");
        },
      } as unknown as ButtonInteraction;
    },
  } as unknown as Message;

  const interactionState = {
    id: "root-interaction",
    user: { id: "user-1" },
    guild: null,
    client: {
      user: {
        displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
      },
    },
    replied: false,
    deferred: false,
    isChatInputCommand: () => true,
    deferReply: async () => {
      interactionState.deferred = true;
    },
    editReply: async (payload: InteractionEditReplyOptions) => {
      edits.push(payload);
      return message;
    },
  };

  return {
    interaction: interactionState as unknown as ChatInputCommandInteraction,
    edits,
    deferredButtons,
  };
}

describe("replyPaginatedPersonaChoicesV2 terminal attachment cleanup", () => {
  for (const outcome of ["cancel", "timeout"] as const) {
    it(`clears a local avatar attachment when the picker reaches ${outcome}`, async () => {
      const harness = makeHarness(outcome);
      const avatarSessionCache: AvatarSessionCache = new Map([
        [0, { type: "buffer", buffer: Buffer.from("local-avatar") }],
      ]);

      const result = await replyPaginatedPersonaChoicesV2(harness.interaction, "en-US", {
        personas: [makePersona()],
        preserveSelectedInteraction: true,
        avatarSessionCache,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe(outcome === "cancel" ? "cancelled" : "timeout");
      expect(harness.edits).toHaveLength(2);
      expect(harness.edits[0]?.files).toHaveLength(1);
      expect(harness.edits[1]?.attachments).toEqual([]);
      expect(harness.deferredButtons).toEqual(outcome === "cancel" ? ["cancel-button"] : []);
    });
  }
});
