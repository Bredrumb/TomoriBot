/**
 * Selector-style tests for promptWithPaginatedModal (Phase 2 of the
 * paginated-modal-selector-consistency plan).
 *
 * Confirms two things at the `>25`-option boundary:
 *   1. The DEFAULT (legacy) style is unchanged — a numbered page-button embed.
 *   2. selectorStyle:"componentsV2" renders the shared range-selector container
 *      (range/previous/cancel/next buttons), carries IsComponentsV2, never emits
 *      legacy embeds, and marks the interaction for the Phase 1 collision guard.
 *
 * Mock-free (real interactionCore), so the official runner batches this into the
 * shared unit lane where interactionCore is never mocked. Each case ends the await
 * loop by rejecting awaitMessageComponent, so no modal is ever shown.
 */

import { describe, expect, it } from "bun:test";
import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import type { ModalOptions } from "@/types/discord/modal";
import { hasComponentsV2Reply, promptWithPaginatedModal } from "@/utils/discord/ui/interactionCore";

/** One recorded acknowledgement call. */
interface RecordedCall {
  method: "reply" | "editReply" | "webhook.send";
  payload: Record<string, unknown>;
}

/** Builds a modal with `count` select options so the paginated path triggers. */
function makeOptions(count: number, selectorStyle?: "legacy" | "componentsV2"): ModalOptions {
  return {
    modalCustomId: "test_modal",
    modalTitleKey: "commands.model.text.modal_title",
    selectorStyle,
    components: [
      {
        customId: "sel",
        labelKey: "commands.model.text.select_label",
        options: Array.from({ length: count }, (_, index) => ({
          label: `option-${index}`,
          value: `value-${index}`,
        })),
      },
    ],
  };
}

/**
 * Fake unacknowledged interaction. reply() records its payload; fetchReply()
 * returns a message whose awaitMessageComponent rejects, ending the selector loop
 * with a timeout before any modal opens.
 */
function makeInteraction(): { interaction: ChatInputCommandInteraction; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const message = {
    awaitMessageComponent: async () => {
      throw new Error("collector ended");
    },
  };
  const interaction = {
    id: "interaction-1",
    deferred: false,
    replied: false,
    user: { id: "user-1" },
    reply: async (payload: Record<string, unknown>) => {
      calls.push({ method: "reply", payload });
      interaction.replied = true;
    },
    editReply: async (payload: Record<string, unknown>) => {
      calls.push({ method: "editReply", payload });
      return message;
    },
    fetchReply: async () => message,
    webhook: {
      send: async (payload: Record<string, unknown>) => {
        calls.push({ method: "webhook.send", payload });
        return message;
      },
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, calls };
}

/**
 * Recursively collects every custom id from a component tree. Handles both plain
 * Components V2 data (`customId`) and discord.js builder JSON (`custom_id`).
 */
function collectCustomIds(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(collectCustomIds);
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    const ids: string[] = [];
    if (typeof record.customId === "string") ids.push(record.customId);
    if (typeof record.custom_id === "string") ids.push(record.custom_id);
    return [...ids, ...collectCustomIds(record.components)];
  }
  return [];
}

describe("promptWithPaginatedModal selectorStyle", () => {
  it("defaults to the legacy numbered page-button embed (unchanged)", async () => {
    const { interaction, calls } = makeInteraction();

    const result = await promptWithPaginatedModal(interaction, "en-US", makeOptions(26));

    expect(result.outcome).toBe("timeout");
    expect(calls).toHaveLength(1);
    const payload = calls[0].payload;
    // Legacy path carries embeds, never IsComponentsV2.
    expect(Array.isArray(payload.embeds)).toBe(true);
    const flags = (payload.flags as number) ?? 0;
    expect(flags & MessageFlags.IsComponentsV2).toBe(0);
    // Numbered page buttons: 26 options -> 2 pages -> page_1, page_2.
    const actionRow = (payload.components as Array<{ toJSON: () => unknown }>)[0];
    const ids = collectCustomIds(actionRow.toJSON());
    expect(ids).toContain("page_1");
    expect(ids).toContain("page_2");
    // The legacy selector must NOT mark the interaction as V2.
    expect(hasComponentsV2Reply(interaction)).toBe(false);
  });

  it("renders the Components V2 range selector when selectorStyle is componentsV2", async () => {
    const { interaction, calls } = makeInteraction();

    const result = await promptWithPaginatedModal(interaction, "en-US", makeOptions(26, "componentsV2"));

    expect(result.outcome).toBe("timeout");
    expect(calls).toHaveLength(1);
    const payload = calls[0].payload;
    // V2 payload: components + IsComponentsV2 + Ephemeral, never embeds.
    expect("embeds" in payload).toBe(false);
    expect(payload.flags).toBe(MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
    // Range + navigation buttons scoped to a per-session prefix.
    const ids = collectCustomIds(payload.components);
    expect(ids.some((id) => id.endsWith("_range_0"))).toBe(true);
    expect(ids.some((id) => id.endsWith("_range_1"))).toBe(true);
    expect(ids.some((id) => id.endsWith("_cancel"))).toBe(true);
    expect(ids.some((id) => id.endsWith("_previous"))).toBe(true);
    expect(ids.some((id) => id.endsWith("_next"))).toBe(true);
    // The interaction is marked so a later legacy embed sink renders a V2 notice.
    expect(hasComponentsV2Reply(interaction)).toBe(true);
  });
});
