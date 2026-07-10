import { describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import { HumanizerDegree, type TomoriState } from "@/types/db/schema";
import type { StreamConfig, StreamContext } from "@/types/stream/interfaces";
import type { ChannelLockEntry } from "@/utils/chat/channelQueue";
import { queueAdditionalPersonaTurns } from "@/utils/chat/personaQueue";
import { collectRenderModifierSourceNames, parseLeadingRenderModifier } from "@/utils/discord/renderModifierParser";
import { createStreamTextProcessingConfig } from "@/utils/discord/stream/textConfig";

function makePersona(personaId: number, nickname: string): TomoriState {
  return {
    persona_id: personaId,
    persona_nickname: nickname,
    config: {},
  } as TomoriState;
}

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
    minVisibleDurationMs: 0,
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
    };

    const handledNow = queueAdditionalPersonaTurns({
      lockEntry,
      message: {} as Message,
      personasToRespond: [makePersona(1, "Rose"), makePersona(2, "Temari")],
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
    };
    const lilya = makePersona(1, "Lilya");
    const aphel = makePersona(2, "Aphel");
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

    const textConfig = createStreamTextProcessingConfig(makeStreamConfig(), {
      tomoriState: queuedPersona,
      contextItems: [],
      currentTurnModelParts: [],
      provider: "_test",
      locale: "en-US",
      personaUsername: queuedPersona?.persona_nickname,
    } as StreamContext);
    const sourceNames = collectRenderModifierSourceNames(textConfig.botName, textConfig.botNameAliases);

    expect(textConfig.botName).toBe("Aphel");
    expect(parseLeadingRenderModifier("Aphel (embarrassed): Can you not?", sourceNames)).toMatchObject({
      sourceName: "Aphel",
      modifier: "embarrassed",
      body: "Can you not?",
    });
  });
});
