import { describe, expect, it } from "bun:test";
import { TextChannel, type Client, type Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { shouldBotReply } from "@/utils/chat/admission";
import { determineMatchingPersonas, isSelfTriggerMessage } from "@/utils/chat/triggerProcessor";

type ProviderFixtureName = "google" | "openrouter" | "novelai";

type PersonaFixture = {
  id: number;
  nickname: string;
  isAlter: boolean;
  triggers: string[];
};

type AutochatPersonaOverrideFixture = {
  channelDiscId: string;
  tomoriId: number;
};

type ConversationFixture = {
  id: string;
  provider: ProviderFixtureName;
  description: string;
  message: {
    authorId: string;
    authorName: string;
    authorBot?: boolean;
    content: string;
    mentionedUserIds: string[];
    webhookId?: string | null;
  };
  state: {
    deliberateTriggerMode: boolean;
    alwaysReplyEnabled: boolean;
    autochDiscIds: string[];
    autochPersonaOverrides: AutochatPersonaOverrideFixture[];
    autochCounter: number;
    autochNextTarget: number;
  };
  personas: PersonaFixture[];
  triggerContext: {
    isReplyToBot: boolean;
    replyPersonaId: number | null;
    isBotMentioned: boolean;
    isAutoMsgHit: boolean;
    isAlwaysReply: boolean;
    autoTriggerPersonaId: number | null;
    alwaysReplyFallbackPersonaId: number | null;
    deliberateTriggerMode: boolean;
    isAutochatDtmExemptChannel: boolean;
    allowedPersonaIds: number[] | null;
  };
};

type ExpectedDecision = {
  provider: ProviderFixtureName;
  shouldReply: boolean;
  matchingPersonaNicknames: string[];
};

const botUserId = "bot_001";
const guildId = "guild_001";
const channelId = "channel_001";

const conversations = (await Bun.file(
  "tests/regression/chat/fixtures/conversations.json",
).json()) as ConversationFixture[];
const expectedDecisions = (await Bun.file("tests/regression/chat/fixtures/expected-decisions.json").json()) as Record<
  string,
  ExpectedDecision
>;

function makeClient(): Client {
  return {
    user: {
      id: botUserId,
    },
  } as unknown as Client;
}

function makeTextChannel(): TextChannel {
  const channel = Object.create(TextChannel.prototype) as TextChannel & {
    id: string;
    parentId: string | null;
    messages: { cache: Map<string, Message> };
    isThread: () => boolean;
  };

  channel.id = channelId;
  channel.parentId = null;
  channel.messages = { cache: new Map<string, Message>() };
  channel.isThread = () => false;

  return channel;
}

function makeMessage(fixture: ConversationFixture, client: Client): Message {
  const mentionedUserIds = new Set(fixture.message.mentionedUserIds);
  const channel = makeTextChannel();

  const message = {
    id: `msg_${fixture.id}`,
    channel,
    channelId,
    client,
    guild: {
      id: guildId,
    },
    webhookId: null,
    interaction: null,
    reference: null,
    content: fixture.message.content,
    author: {
      id: fixture.message.authorId,
      username: fixture.message.authorName,
      bot: fixture.message.authorBot ?? false,
    },
    mentions: {
      users: {
        has: (userId: string) => mentionedUserIds.has(userId),
      },
    },
  } as unknown as Message;

  message.webhookId = fixture.message.webhookId ?? null;
  return message;
}

function makeTomoriState(fixture: ConversationFixture, persona: PersonaFixture): TomoriState {
  return {
    tomori_id: persona.id,
    tomori_nickname: persona.nickname,
    is_alter: persona.isAlter,
    trigger_words: persona.triggers,
    alter_triggers: persona.isAlter ? persona.triggers : null,
    autoch_counter: fixture.state.autochCounter,
    autoch_next_target: fixture.state.autochNextTarget,
    config: {
      trigger_words: persona.isAlter ? [] : persona.triggers,
      deliberate_trigger_mode: fixture.state.deliberateTriggerMode,
      always_reply_enabled: fixture.state.alwaysReplyEnabled,
      autoch_disc_ids: fixture.state.autochDiscIds,
      autoch_persona_overrides: fixture.state.autochPersonaOverrides.map((override) => ({
        channel_disc_id: override.channelDiscId,
        tomori_id: override.tomoriId,
      })),
      autoch_threshold: 0,
      autoch_threshold_max: 0,
      cascade_limit: 0,
    },
  } as unknown as TomoriState;
}

describe("chat regression harness", () => {
  for (const fixture of conversations) {
    it(`${fixture.provider}: ${fixture.description}`, () => {
      const client = makeClient();
      const message = makeMessage(fixture, client);
      const personas = fixture.personas.map((persona) => makeTomoriState(fixture, persona));
      const mainPersona = personas.find((persona) => !persona.is_alter);
      const replyPersona =
        fixture.triggerContext.replyPersonaId === null
          ? null
          : (personas.find((persona) => persona.tomori_id === fixture.triggerContext.replyPersonaId) ?? null);
      const allowedPersonaIds =
        fixture.triggerContext.allowedPersonaIds === null ? null : new Set(fixture.triggerContext.allowedPersonaIds);

      if (!mainPersona) {
        throw new Error(`Fixture ${fixture.id} is missing a main persona`);
      }

      const actualDecision: ExpectedDecision = {
        provider: fixture.provider,
        shouldReply: shouldBotReply(message, mainPersona, personas, {
          allowedPersonaIds,
        }),
        matchingPersonaNicknames: determineMatchingPersonas(
          message,
          personas,
          client,
          fixture.triggerContext.isReplyToBot,
          replyPersona,
          fixture.triggerContext.isBotMentioned,
          fixture.triggerContext.isAutoMsgHit,
          fixture.triggerContext.isAlwaysReply,
          fixture.triggerContext.autoTriggerPersonaId,
          fixture.triggerContext.alwaysReplyFallbackPersonaId,
          fixture.triggerContext.deliberateTriggerMode,
          fixture.triggerContext.isAutochatDtmExemptChannel,
          allowedPersonaIds,
        ).map((persona) => persona.tomori_nickname ?? `id:${persona.tomori_id}`),
      };

      expect(actualDecision).toEqual(expectedDecisions[fixture.id]);
    });
  }

  it("identifies persona webhook messages as self-trigger messages", () => {
    const fixture = conversations.find((conversation) => conversation.id === "google-persona-webhook-self-trigger");
    if (!fixture) {
      throw new Error("Missing google-persona-webhook-self-trigger fixture");
    }

    const client = makeClient();
    const message = makeMessage(fixture, client);
    const personas = fixture.personas.map((persona) => makeTomoriState(fixture, persona));

    expect(isSelfTriggerMessage(message, personas)).toBe(true);
  });

  it.skip("[REGRESSION PROBE] fails when a fixture expectation is deliberately inverted", () => {
    const googleFixture = conversations.find((fixture) => fixture.id === "google-direct-mention-main");
    if (!googleFixture) {
      throw new Error("Missing google-direct-mention-main fixture");
    }

    const client = makeClient();
    const message = makeMessage(googleFixture, client);
    const personas = googleFixture.personas.map((persona) => makeTomoriState(googleFixture, persona));
    const mainPersona = personas.find((persona) => !persona.is_alter);

    if (!mainPersona) {
      throw new Error("Probe fixture is missing a main persona");
    }

    expect(shouldBotReply(message, mainPersona, personas)).toBe(false);
  });
});
