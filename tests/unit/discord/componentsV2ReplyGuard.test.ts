/**
 * Components V2 reply-guard tests (Phase 1 of the paginated-modal-selector-consistency plan).
 *
 * Once a message carries `IsComponentsV2`, Discord permanently forbids editing it with
 * legacy `embeds`/`content`. `interactionCore` tracks such interactions in a WeakSet and
 * teaches the shared legacy sinks (`replyInfoEmbed`, `replySummaryEmbed`,
 * `replyPaginatedStatusPages`) to emit a V2 notice container instead of embeds when the
 * target is marked.
 *
 * These tests import the REAL `interactionCore` and use no `mock.module`, so the official
 * runner batches this file into the shared unit lane where `interactionCore` is never
 * mocked. See scripts/checks/runTests.ts (planLanes) and tests/unit/checks/
 * testIsolationHygiene.test.ts for why this keeps the real module intact.
 */

import { describe, expect, it } from "bun:test";
import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import {
  hasComponentsV2Reply,
  markComponentsV2Reply,
  replyComponentsV2Status,
  replyInfoEmbed,
} from "@/utils/discord/ui/interactionCore";

/** One recorded acknowledgement call against the fake interaction. */
interface RecordedCall {
  method: "reply" | "editReply" | "webhook.send";
  payload: Record<string, unknown>;
}

/**
 * Minimal fake interaction that records the payload of every acknowledgement call.
 * `deferred` controls whether the sink routes to editReply (acknowledged) or reply.
 */
function makeInteraction(deferred: boolean): {
  interaction: ChatInputCommandInteraction;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const interaction = {
    id: "fake-interaction",
    deferred,
    replied: false,
    guild: null,
    user: { id: "user-1" },
    reply: async (payload: Record<string, unknown>) => {
      calls.push({ method: "reply", payload });
    },
    editReply: async (payload: Record<string, unknown>) => {
      calls.push({ method: "editReply", payload });
    },
    webhook: {
      send: async (payload: Record<string, unknown>) => {
        calls.push({ method: "webhook.send", payload });
      },
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, calls };
}

const infoOptions = {
  titleKey: "general.errors.unknown_error_title",
  descriptionKey: "general.errors.unknown_error_description",
  color: "#E74C3C",
} as const;

describe("Components V2 reply guard", () => {
  it("emits a legacy embed when the interaction is NOT marked (control)", async () => {
    const { interaction, calls } = makeInteraction(true);

    await replyInfoEmbed(interaction, "en-US", { ...infoOptions });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe("editReply");
    // Legacy path carries embeds and an empty components array, never IsComponentsV2.
    expect(Array.isArray(call.payload.embeds)).toBe(true);
    expect(call.payload.flags).toBeUndefined();
  });

  it("emits a Components V2 notice (never embeds) when the interaction is marked — editReply path", async () => {
    const { interaction, calls } = makeInteraction(true);
    markComponentsV2Reply(interaction);

    await replyInfoEmbed(interaction, "en-US", { ...infoOptions });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe("editReply");
    // The payload is a V2 component container.
    expect(call.payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(Array.isArray(call.payload.components)).toBe(true);
    expect((call.payload.components as unknown[]).length).toBeGreaterThan(0);
    // It MUST NOT carry legacy embeds — Discord rejects those on a V2 message.
    expect("embeds" in call.payload).toBe(false);
  });

  it("emits an ephemeral Components V2 notice on the fresh reply path when marked", async () => {
    const { interaction, calls } = makeInteraction(false);
    markComponentsV2Reply(interaction);

    await replyInfoEmbed(interaction, "en-US", { ...infoOptions });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe("reply");
    expect(call.payload.flags).toBe(MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
    expect("embeds" in call.payload).toBe(false);
  });

  it("marks the interaction after replyComponentsV2Status writes a V2 payload", async () => {
    const { interaction } = makeInteraction(true);
    expect(hasComponentsV2Reply(interaction)).toBe(false);

    await replyComponentsV2Status(
      interaction,
      "en-US",
      "general.errors.unknown_error_title",
      "general.errors.unknown_error_description",
      "#3498DB",
    );

    // The status writer stamped IsComponentsV2 onto the reply, so a later legacy
    // sink on the same interaction must now render a V2 notice instead of embeds.
    expect(hasComponentsV2Reply(interaction)).toBe(true);
  });
});
