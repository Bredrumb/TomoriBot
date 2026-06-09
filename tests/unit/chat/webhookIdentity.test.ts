import { describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { resolveReferencedWebhookTarget } from "@/utils/chat/webhookIdentity";

function persona(nickname: string, id: number): TomoriState {
  return {
    persona_id: id,
    persona_nickname: nickname,
  } as TomoriState;
}

function webhookMessage(username: string): Message {
  return {
    webhookId: "webhook_1",
    author: {
      username,
    },
  } as Message;
}

describe("resolveReferencedWebhookTarget", () => {
  it("routes replies to copied-render webhook names back to the source persona", () => {
    const ren = persona("Ren", 123);
    const personaByNickname = new Map([["ren", ren]]);

    const result = resolveReferencedWebhookTarget(webhookMessage("Ren (bredrumb)"), personaByNickname, null);

    expect(result.replyPersona).toBe(ren);
    expect(result.impersonatedUserId).toBeNull();
  });
});
