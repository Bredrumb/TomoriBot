import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Message, Webhook } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import { InteractWithRecentMessageTool } from "@/tools/functionCalls/interactWithRecentMessageTool";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";

const MAIN = { persona_id: 1, persona_nickname: "Tomori", is_alter: false } as unknown as TomoriState;
const ALTER = { persona_id: 2, persona_nickname: "Mirri", is_alter: true } as unknown as TomoriState;
const BOT_USER_ID = "bot-user";

interface DeliveryResult {
  kind: "direct" | "webhook";
  targetPersonaMatched: boolean;
  senderPersona?: TomoriState;
  identity?: { username: string };
}

interface DeliveryResolver {
  resolveReplyDeliveryContext(context: ToolContext, targetMessage: Message): Promise<DeliveryResult>;
}

const alterWebhookMessage = {
  webhookId: "webhook-1",
  author: { id: "webhook-1", username: ALTER.persona_nickname },
} as unknown as Message;

const mainBotMessage = { webhookId: null, author: { id: BOT_USER_ID, username: "Tomori" } } as unknown as Message;

function makeContext(activePersonaId: number | undefined): ToolContext {
  return {
    guildId: "guild-1",
    activePersonaId,
    tomoriState: MAIN,
    personaUsername: activePersonaId === ALTER.persona_id ? ALTER.persona_nickname : MAIN.persona_nickname,
    // A supplied webhook skips host-channel lookup, so no webhook module has to be mocked.
    webhook: { id: "webhook-1" } as unknown as Webhook,
    channel: { isThread: () => false },
    client: { user: { id: BOT_USER_ID }, guilds: { cache: new Map() } },
  } as unknown as ToolContext;
}

function resolve(context: ToolContext, message: Message): Promise<DeliveryResult> {
  return (new InteractWithRecentMessageTool() as unknown as DeliveryResolver).resolveReplyDeliveryContext(
    context,
    message,
  );
}

describe("interact_with_recent_message reply delivery identity", () => {
  let personas: ReturnType<typeof spyOn<typeof tomoriStateCache, "getCachedAllPersonas">>;

  beforeEach(() => {
    personas = spyOn(tomoriStateCache, "getCachedAllPersonas");
  });

  afterEach(() => {
    personas.mockRestore();
  });

  it("speaks as the active persona when the target message belongs to a different persona", async () => {
    personas.mockResolvedValue([MAIN, ALTER]);

    const result = await resolve(makeContext(MAIN.persona_id), alterWebhookMessage);

    expect(result.kind).toBe("webhook");
    expect(result.targetPersonaMatched).toBe(false);
    expect(result.senderPersona).toBeUndefined();
    expect(result.identity?.username).toBe(MAIN.persona_nickname);
  });

  it("speaks as the target alter only when the active persona authored the target message", async () => {
    personas.mockResolvedValue([MAIN, ALTER]);

    const result = await resolve(makeContext(ALTER.persona_id), alterWebhookMessage);

    expect(result.kind).toBe("webhook");
    expect(result.targetPersonaMatched).toBe(true);
    expect(result.senderPersona?.persona_id).toBe(ALTER.persona_id);
    expect(result.identity?.username).toBe(ALTER.persona_nickname);
  });

  it("does not borrow the main persona's identity when an alter replies to a main-persona message", async () => {
    personas.mockResolvedValue([MAIN, ALTER]);

    const result = await resolve(makeContext(ALTER.persona_id), mainBotMessage);

    expect(result.targetPersonaMatched).toBe(false);
    expect(result.senderPersona).toBeUndefined();
    expect(result.identity?.username).toBe(ALTER.persona_nickname);
  });

  it("replies directly as the main persona on its own message", async () => {
    personas.mockResolvedValue([MAIN, ALTER]);

    const result = await resolve(makeContext(MAIN.persona_id), mainBotMessage);

    expect(result.kind).toBe("direct");
    expect(result.targetPersonaMatched).toBe(true);
    expect(result.senderPersona?.persona_id).toBe(MAIN.persona_id);
  });

  it("never adopts a target persona identity when the active persona is unknown", async () => {
    personas.mockResolvedValue([MAIN, ALTER]);

    const result = await resolve(makeContext(undefined), alterWebhookMessage);

    expect(result.targetPersonaMatched).toBe(false);
    expect(result.senderPersona).toBeUndefined();
  });
});
