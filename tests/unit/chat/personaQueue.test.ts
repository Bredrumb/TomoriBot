import { describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { ChannelLockEntry } from "@/utils/chat/channelQueue";
import { queueAdditionalPersonaTurns } from "@/utils/chat/personaQueue";

function makePersona(personaId: number, nickname: string): TomoriState {
  return {
    persona_id: personaId,
    persona_nickname: nickname,
  } as TomoriState;
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
});
