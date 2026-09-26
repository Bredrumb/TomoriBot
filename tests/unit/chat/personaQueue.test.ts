import { describe, expect, it } from "bun:test";
import type { Client, Message } from "discord.js";
import { HumanizerDegree } from "@/types/db/schema";
import type { StreamConfig, StreamContext } from "@/types/stream/interfaces";
import type { ChannelLockEntry } from "@/utils/chat/channelQueue";
import { queueAdditionalPersonaTurns } from "@/utils/chat/personaQueue";
import { collectRenderModifierSourceNames, parseLeadingRenderModifier } from "@/utils/discord/renderModifierParser";
import { createStreamTextProcessingConfig } from "@/utils/discord/stream/textConfig";
import { createPersona } from "../../helpers/fixtures";

function makeStreamConfig(): StreamConfig {
  return {
    model: "_test",
    apiKey: "_test",
    temperature: 0,
    maxMessageLength: 2000,
    flushBufferSize: 1000,
    flushBufferSizeCodeBlock: 15000,
    inactivityTimeoutMs: 30000,
    baseTypeSpeedMsPerChar: 0,
    maxTypingTimeMs: 0,
    minVisibleTypingDurationMs: 0,
    humanizerDegree: HumanizerDegree.NONE,
    emojiUsageEnabled: true,
  };
}

describe("queueAdditionalPersonaTurns", () => {
  it("preserves the original triggered persona set on queued persona jobs", () => {
    const lockEntry: ChannelLockEntry = {
      isLocked: true,
      lockedAt: Date.now(),
      serverDiscId: "_rt_server",
      typingKeepaliveTimer: null,
      followUpCount: 0,
      messageQueue: [],
      activeTurnAbortController: null,
    };

    const handledNow = queueAdditionalPersonaTurns({
      lockEntry,
      message: {} as Message,
      personasToRespond: [
        createPersona({ persona_id: 1, persona_nickname: "Rose" }),
        createPersona({ persona_id: 2, persona_nickname: "Temari" }),
      ],
      triggeredPersonaIds: [1, 2],
      textQuotaSource: "user",
      textQuotaTriggerKey: "_rt_turn",
      textQuotaUserDiscId: "_rt_user",
    });

    expect(handledNow.map((persona) => persona.persona_id)).toEqual([1]);
    expect(lockEntry.messageQueue).toHaveLength(1);
    expect(lockEntry.messageQueue[0]?.selectedPersonaId).toBe(2);
    expect(lockEntry.messageQueue[0]?.triggeredPersonaIds).toEqual([1, 2]);
  });

  it("lets a queued persona become the active render-modifier source", () => {
    const lockEntry: ChannelLockEntry = {
      isLocked: true,
      lockedAt: Date.now(),
      serverDiscId: "_rt_server",
      typingKeepaliveTimer: null,
      followUpCount: 0,
      messageQueue: [],
      activeTurnAbortController: null,
    };
    const lilya = createPersona({ persona_id: 1, persona_nickname: "Lilya" });
    const aphel = createPersona({ persona_id: 2, persona_nickname: "Aphel" });
    const allPersonas = [lilya, aphel];

    queueAdditionalPersonaTurns({
      lockEntry,
      message: {} as Message,
      personasToRespond: allPersonas,
      triggeredPersonaIds: [1, 2],
      textQuotaSource: "user",
      textQuotaTriggerKey: "_rt_turn",
      textQuotaUserDiscId: "_rt_user",
    });

    const queuedPersonaId = lockEntry.messageQueue[0]?.selectedPersonaId;
    const queuedPersona = allPersonas.find((persona) => persona.persona_id === queuedPersonaId);
    expect(queuedPersona?.persona_nickname).toBe("Aphel");
    if (!queuedPersona) throw new Error("Expected the second persona to be queued");

    const textConfig = createStreamTextProcessingConfig(makeStreamConfig(), {
      channel: { id: "_rt_channel" } as unknown as StreamContext["channel"],
      client: {} as Client,
      tomoriState: queuedPersona,
      contextItems: [],
      currentTurnModelParts: [],
      provider: "_test",
      locale: "en-US",
      personaUsername: queuedPersona.persona_nickname,
    });
    const sourceNames = collectRenderModifierSourceNames(textConfig.botName, textConfig.botNameAliases);

    expect(textConfig.botName).toBe("Aphel");
    expect(parseLeadingRenderModifier("Aphel (embarrassed): Can you not?", sourceNames)).toMatchObject({
      sourceName: "Aphel",
      modifier: "embarrassed",
      body: "Can you not?",
    });
  });
});
