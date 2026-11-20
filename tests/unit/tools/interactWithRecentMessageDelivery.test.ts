import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Collection, type Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import { InteractWithRecentMessageTool } from "@/tools/functionCalls/interactWithRecentMessageTool";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { clearWebhookIdentityCache } from "@/utils/chat/webhookIdentity";
import * as personaPost from "@/utils/discord/webhook/personaPost";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createPersona } from "../../helpers/fixtures";

const MAIN = createPersona({ persona_id: 1, persona_nickname: "Tomori", is_alter: false });
const ALTER = createPersona({ persona_id: 2, persona_nickname: "Mirri", is_alter: true });
const BOT_USER_ID = "bot-user";
const CHANNEL = "channel-1";

interface DeliveryResult {
  senderPersona: TomoriState;
  targetPersonaMatched: boolean;
}

interface DeliveryResolver {
  resolveReplyDeliveryContext(context: ToolContext, targetMessage: Message): Promise<DeliveryResult>;
}

const alterWebhookMessage = {
  id: "1400000000000000100",
  webhookId: "webhook-1",
  guildId: "guild-1",
  channelId: CHANNEL,
  channel: { isThread: () => false },
  author: { id: "webhook-1", username: ALTER.persona_nickname },
  attachments: new Collection(),
  stickers: new Collection(),
  content: "hello",
  cleanContent: "hello",
  createdTimestamp: 0,
} as unknown as Message;

const mainBotMessage = {
  id: "1400000000000000101",
  webhookId: null,
  guildId: "guild-1",
  channelId: CHANNEL,
  channel: { isThread: () => false },
  author: { id: BOT_USER_ID, username: "Tomori" },
  member: { displayName: "Tomori" },
  attachments: new Collection(),
  stickers: new Collection(),
  content: "hello",
  cleanContent: "hello",
  createdTimestamp: 0,
} as unknown as Message;

function makeContext(activePersonaId: number | undefined): ToolContext {
  return {
    guildId: "guild-1",
    activePersonaId,
    tomoriState: MAIN,
    channel: {
      id: CHANNEL,
      guildId: "guild-1",
      lastMessageId: null,
      isThread: () => false,
      parent: null,
      send: mock(),
      permissionsFor: () => ({ has: () => true }),
    },
    client: { user: { id: BOT_USER_ID }, guilds: { cache: new Map() } },
    locale: "en-US",
    messageIdMap: new MessageIdMap(),
    contextItems: [],
  } as unknown as ToolContext;
}

function resolve(context: ToolContext, message: Message): Promise<DeliveryResult> {
  return (new InteractWithRecentMessageTool() as unknown as DeliveryResolver).resolveReplyDeliveryContext(
    context,
    message,
  );
}

describe("interact_with_recent_message reply delivery identity", () => {
  it("rejects reactions before touching Discord when emojis are disabled", async () => {
    const context = makeContext(MAIN.persona_id);
    context.tomoriState = createPersona({ config: { emoji_usage_enabled: false } });
    const result = await new InteractWithRecentMessageTool().execute(
      { action: "react", message_id: mainBotMessage.id, content: "👍" },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({ status: "emoji_reactions_disabled" });
  });

  let personas: ReturnType<typeof spyOn<typeof tomoriStateCache, "getCachedAllPersonas">>;
  let managed: ReturnType<typeof spyOn<typeof serverRepository, "loadManagedWebhookByChannelAndWebhookId">>;
  const tracked: Array<{ mockRestore(): void }> = [];

  beforeEach(() => {
    personas = spyOn(tomoriStateCache, "getCachedAllPersonas");
    clearWebhookIdentityCache();
    managed = spyOn(serverRepository, "loadManagedWebhookByChannelAndWebhookId").mockResolvedValue({
      managed_webhook_id: 1,
      guild_disc_id: "guild-1",
      channel_disc_id: CHANNEL,
      webhook_disc_id: "webhook-1",
      kind: "shared_channel",
      avatar_fingerprint: null,
      discord_avatar_hash: null,
      webhook_token: Buffer.from("fixture"),
      key_version: 1,
    });
  });

  afterEach(() => {
    for (const spy of tracked.splice(0)) spy.mockRestore();
    personas.mockRestore();
    managed.mockRestore();
    clearWebhookIdentityCache();
    mock.restore();
  });

  it("speaks as the active persona when the target message belongs to a different persona", async () => {
    personas.mockResolvedValue([MAIN, ALTER]);

    const result = await resolve(makeContext(MAIN.persona_id), alterWebhookMessage);

    expect(result.targetPersonaMatched).toBe(false);
    expect(result.senderPersona.persona_id).toBe(MAIN.persona_id);
  });

  it("speaks as the target alter only when the active persona authored the target message", async () => {
    personas.mockResolvedValue([MAIN, ALTER]);

    const result = await resolve(makeContext(ALTER.persona_id), alterWebhookMessage);

    expect(result.targetPersonaMatched).toBe(true);
    expect(result.senderPersona.persona_id).toBe(ALTER.persona_id);
  });

  it("does not borrow the main persona's identity when an alter replies to a main-persona message", async () => {
    personas.mockResolvedValue([MAIN, ALTER]);

    const result = await resolve(makeContext(ALTER.persona_id), mainBotMessage);

    expect(result.targetPersonaMatched).toBe(false);
    expect(result.senderPersona.persona_id).toBe(ALTER.persona_id);
  });

  it("replies directly as the main persona on its own message", async () => {
    personas.mockResolvedValue([MAIN, ALTER]);

    const result = await resolve(makeContext(MAIN.persona_id), mainBotMessage);

    expect(result.targetPersonaMatched).toBe(true);
    expect(result.senderPersona.persona_id).toBe(MAIN.persona_id);
  });

  it("never adopts a target persona identity when the active persona is unknown", async () => {
    personas.mockResolvedValue([MAIN, ALTER]);

    const result = await resolve(makeContext(undefined), alterWebhookMessage);

    expect(result.targetPersonaMatched).toBe(false);
    expect(result.senderPersona.persona_id).toBe(MAIN.persona_id);
  });

  it("delivers text replies with emojis disabled as the invoking persona", async () => {
    personas.mockResolvedValue([MAIN, ALTER]);
    tracked.push(
      spyOn(personaPost, "resolvePersonaPostAuthor").mockResolvedValue({
        route: "bot",
        identity: { username: "Tomori" },
        speaker: { personaId: MAIN.persona_id ?? null, kind: "appearance" },
      }),
    );
    const send = spyOn(personaPost, "sendPersonaPost").mockImplementation(async (_context, _payload) => ({
      status: "sent",
      message: { id: "sent-1", channelId: CHANNEL } as unknown as Message,
      receipt: {
        messageId: "sent-1",
        channelId: CHANNEL,
        route: "bot",
        webhookId: null,
        identity: { username: "Tomori" },
        speaker: { personaId: MAIN.persona_id ?? null, kind: "appearance" },
      },
    }));
    tracked.push(send);

    const context = makeContext(MAIN.persona_id);
    context.tomoriState = createPersona({ ...MAIN, config: { ...MAIN.config, emoji_usage_enabled: false } });
    const channel = context.channel as unknown as {
      messages: { fetch: () => Promise<Collection<string, Message>> };
    };
    for (const target of [mainBotMessage, alterWebhookMessage]) {
      channel.messages = {
        fetch: async () => new Collection<string, Message>([[target.id, target]]),
      };

      const result = await new InteractWithRecentMessageTool().execute(
        { action: "reply", message_id: target.id, content: "Congrats on the thing" },
        context,
      );

      expect(result.success).toBe(true);
      const delivered = send.mock.calls.at(-1);
      expect(delivered?.[0].persona.persona_id).toBe(MAIN.persona_id);
      expect(delivered?.[0].replyToMessage).toBe(target);
      expect((result.data as { reply_sender_persona_id?: number }).reply_sender_persona_id).toBe(MAIN.persona_id);
      expect((result.data as { used_webhook_context: boolean }).used_webhook_context).toBe(false);
    }
    expect(send).toHaveBeenCalledTimes(2);
  });
});
