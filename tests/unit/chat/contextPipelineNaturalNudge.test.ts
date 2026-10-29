import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Embed, Message } from "discord.js";
import { buildChatTurnContext, resolveTurnDeliberateToolMode } from "@/utils/chat/contextPipeline";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import type { ChatTurn, ChatTurnContext, NaturalNudgeTurn, TomoriChatInput } from "@/utils/chat/types";
import { PrivacyLevel } from "@/types/db/schema";
import * as blockCache from "@/utils/cache/personaUserBlockCache";
import * as userCache from "@/utils/cache/userCache";
import * as reunionPresence from "@/utils/chat/reunionPresence";
import * as dbClient from "@/utils/db/client";
import * as contextBuilder from "@/utils/text/contextBuilder";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";
import { ToolRegistry } from "@/tools/toolRegistry";
import { getAvailableToolsForContext } from "@/tools/availability";
import { ConditioningInteractionTool } from "@/tools/functionCalls/conditioningInteractionTool";
import { buildConditioningInteractionEvent } from "@/utils/conditioning/conditioningInteractionContext";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { buildConditioningInteractionEmbed } from "@/utils/conditioning/conditioningEmbed";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";

const BOT_ID = "fixture-bot";
beforeAll(initializeLocalizer);

async function buildTurnContext(
  naturalNudge: NaturalNudgeTurn | undefined,
  options: {
    conditioningInteraction?: TomoriChatInput["conditioningInteraction"];
    interactionEnabled?: boolean;
    hasTools?: boolean;
    includeInteractionHistory?: boolean;
    gestureHistory?: boolean;
  } = {},
): Promise<{
  context: ChatTurnContext;
  reunionCalls: number;
  interactionEvent?: StructuredContextItem;
}> {
  const persona = createPersona({
    persona_nickname: "Tomori",
    llm: createLlmRow({ has_tools: options.hasTools ?? true }),
    config: {
      deliberate_tool_mode: true,
      time_awareness_enabled: true,
      personal_memories_enabled: false,
      emoji_usage_enabled: false,
      sticker_usage_enabled: false,
      conditioning_interactions_enabled: options.interactionEnabled ?? true,
    },
  });
  const channel = {
    id: "fixture-channel",
    isThread: () => false,
    messages: {
      cache: new Map(),
      fetch: async () => new Map(messages.map((message) => [message.id, message])),
    },
  };
  const client = {
    user: { id: BOT_ID, username: "Tomori" },
    guilds: { cache: new Map() },
    users: { fetch: async (id: string) => ({ id, username: id }) },
  };
  const base = {
    guildId: "fixture-guild",
    channelId: channel.id,
    webhookId: null,
    channel,
    client,
    embeds: [],
    components: [],
    attachments: new Map(),
    stickers: new Map(),
    reactions: { cache: new Map() },
    createdTimestamp: 1700000000000,
    type: 0,
    reference: null,
  };
  // Newest first, as Discord returns history; the persona spoke last before the lull.
  const messages = [
    { ...base, id: "persona-last", author: { id: BOT_ID, username: "Tomori", bot: true }, content: "see you later" },
    { ...base, id: "human", author: { id: "fixture-juno", username: "Juno", bot: false }, content: "bye" },
  ] as unknown as Message[];
  const trigger = messages[0];
  if (options.conditioningInteraction || options.gestureHistory) {
    const notice = (actorLabel: string) =>
      buildConditioningInteractionEmbed({
        locale: "en-US",
        type: "reward",
        actionKey: "hug",
        actorLabel,
        targetName: persona.persona_nickname,
        reasonText: "being kind",
        footerKey: null,
      }).toJSON() as Embed;
    trigger.content = "";
    trigger.embeds = [notice("Juno")];
    messages.unshift({ ...trigger, id: "later-notice", embeds: [notice("Bau")] } as Message);
    messages.splice(2, 0, { ...trigger, id: "earlier-notice", embeds: [notice("Mirri")] } as Message);
  }
  const interactionEvent = options.conditioningInteraction
    ? buildConditioningInteractionEvent({
        actorName: "Juno",
        targetName: persona.persona_nickname,
        action: "hug",
        reason: "being kind",
        messageId: trigger.id,
      })
    : undefined;
  const incoming = normalizeChatInvocation({
    client: trigger.client,
    message: trigger,
    isFromQueue: false,
    isManuallyTriggered: true,
    naturalNudge,
    conditioningInteraction: options.conditioningInteraction,
    injectedContextItems: interactionEvent ? [interactionEvent] : undefined,
  });
  const turn = {
    persona,
    tomoriState: persona,
    mainPersona: persona,
    allPersonas: [persona],
    userRow: createUserRow({ personal_deliberate_tool_mode: "follow" }),
    userDiscId: BOT_ID,
    serverDiscId: "fixture-guild",
    isDMChannel: false,
    guild: null,
    triggeredPersonaIds: [persona.persona_id],
    requestSnapshot: { tomoriState: persona },
    lockedTurn: {
      channelId: channel.id,
      admission: { incoming, client, message: trigger, channel, locale: "en-US" },
    },
  } as unknown as ChatTurn;
  const spies = [
    spyOn(ToolRegistry, "getAvailableToolsWithMCP").mockImplementation(async (provider, state) => {
      const tools = getAvailableToolsForContext([new ConditioningInteractionTool()], provider, state);
      return { builtInTools: tools, mcpFunctionNames: [], totalCount: tools.length };
    }),
    spyOn(dbClient, "sql").mockImplementation((async () => []) as unknown as typeof dbClient.sql),
    spyOn(userCache, "getCachedUserRow").mockResolvedValue(null),
    spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL),
    spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false),
    spyOn(blockCache, "getCachedActiveBlocksForPersona").mockResolvedValue([]),
    spyOn(naturalNudgeRepository, "loadAgendas").mockResolvedValue(new Map()),
    spyOn(contextBuilder, "buildContext").mockImplementation(async (params) => ({
      contextItems:
        options.conditioningInteraction || options.gestureHistory
          ? params.simplifiedMessageHistory
              .filter((item) => options.includeInteractionHistory !== false || item.id !== trigger.id)
              .map(
                (item): StructuredContextItem => ({
                  role: "user",
                  metadataTag: ContextItemTag.DIALOGUE_HISTORY,
                  messageId: item.id,
                  parts: [{ type: "text", text: item.content ?? "" }],
                }),
              )
          : [],
      tailDirectives: [],
      lowerPriorityTailDirectives: [],
      nudgeInjectionDepth: 0,
      messageIdMap: new MessageIdMap(),
    })),
  ];
  const reunion = spyOn(reunionPresence, "resolveReunionNote").mockResolvedValue({ note: null, presence: null });
  try {
    return { context: await buildChatTurnContext(turn), reunionCalls: reunion.mock.calls.length, interactionEvent };
  } finally {
    for (const spy of [...spies, reunion]) spy.mockRestore();
  }
}

const CONTINUE_DIRECTIVE = "Continue your last message without repeating it";

describe("Natural Nudges turn context", () => {
  it("admits the idle nudge's tools under Deliberate Tool Mode", async () => {
    const { context } = await buildTurnContext({ toolNames: ["web_search"] });
    expect(context.streamingContext.disableAllTools).not.toBe(true);
    expect(context.streamingContext.deliberateToolAllowedNames).toContain("web_search");
  });

  it("skips the trigger author's reunion and the continuation directive", async () => {
    const manual = await buildTurnContext(undefined);
    expect(manual.reunionCalls).toBe(1);
    expect(JSON.stringify(manual.context.contextItems)).toContain(CONTINUE_DIRECTIVE);

    const nudge = await buildTurnContext({ toolNames: [] });
    expect(nudge.reunionCalls).toBe(0);
    expect(JSON.stringify(nudge.context.contextItems)).not.toContain(CONTINUE_DIRECTIVE);
  });

  it("lets a Ping User nudge ping only its target, and leaves other nudges unrestricted", async () => {
    const pingUser = await buildTurnContext({ toolNames: [], targetUserDiscId: "fixture-mirri" });
    expect(pingUser.context.streamingContext.mentionableUserIds).toEqual(["fixture-mirri"]);
    expect(pingUser.context.streamingContext.forcedMentions?.map((mention) => mention.userId)).toContain(
      "fixture-mirri",
    );

    const plainNudge = await buildTurnContext({ toolNames: [] });
    expect(plainNudge.context.streamingContext.mentionableUserIds).toBeUndefined();
  });
});

describe("conditioning turn context", () => {
  it("keeps one recent user event with the available tool hint inside its system notice", async () => {
    for (const actorType of ["user", "persona"] as const) {
      for (const [interactionEnabled, hasTools] of [
        [true, true],
        [false, true],
        [true, false],
      ]) {
        const { context, interactionEvent } = await buildTurnContext(undefined, {
          conditioningInteraction: { actorType, type: "reward" },
          interactionEnabled,
          hasTools,
        });
        const events = context.contextItems.filter((item) => item.messageId === interactionEvent?.messageId);
        expect(events).toHaveLength(1);
        expect(events[0].role).toBe("user");
        expect(events[0].metadataTag).toBe(ContextItemTag.DIALOGUE_HISTORY);
        expect(context.contextItems.at(-1)?.messageId).toBe(interactionEvent?.messageId);
        const text = events
          .flatMap((item) => item.parts)
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n");
        expect(text.includes("`interact_with_target`")).toBe(interactionEnabled && hasTools);
        expect(text).not.toContain("{conditioning_interaction_tool}");
        expect(text).not.toContain("{{if");
        const body = localizedCopy("en-US", "commands.reward.hug.embed_description_with_reason", {
          user: "Juno",
          bot: "Tomori",
          reason: "being kind",
        });
        expect(text.startsWith(`[System: ${body}`)).toBe(true);
        expect(text.endsWith("]")).toBe(true);
        expect(text).not.toContain("\n");
        expect(text.slice(text.indexOf("]") + 1)).toBe("");
        expect(context.contextItems.some((item) => item.messageId === "earlier-notice")).toBe(true);
        expect(context.contextItems.some((item) => item.messageId === "later-notice")).toBe(true);
        expect(JSON.stringify(context.contextItems.filter((item) => item.role === "system"))).not.toContain(
          "interact_with_target",
        );
        expect(JSON.stringify(interactionEvent)).not.toContain("interact_with_target");
        expect(context.streamingContext.disableConditioningInteraction).not.toBe(true);
      }
    }
  });

  it("keeps the reaction event when the delivered message is outside the fetched history", async () => {
    const { context, interactionEvent } = await buildTurnContext(undefined, {
      conditioningInteraction: { actorType: "persona", type: "reward" },
      includeInteractionHistory: false,
    });
    const event = context.contextItems.find((item) => item.messageId === interactionEvent?.messageId);
    expect(event?.role).toBe("user");
    const part = event?.parts[0];
    expect(part?.type).toBe("text");
    if (part?.type === "text") {
      expect(part.text.startsWith("[System: ")).toBe(true);
      expect(part.text.endsWith("]")).toBe(true);
      expect(part.text).toContain("`interact_with_target`");
    }
  });

  it("leaves later gesture history without the reaction turn's tool hint", async () => {
    const { context } = await buildTurnContext(undefined, { gestureHistory: true });
    const text = JSON.stringify(context.contextItems);
    expect(text).toContain(
      localizedCopy("en-US", "commands.reward.hug.embed_description_with_reason", {
        user: "Juno",
        bot: "Tomori",
        reason: "being kind",
      }),
    );
    expect(text).not.toContain("`interact_with_target`");
  });
});

describe("borrowed-trigger Deliberate Tool Mode", () => {
  it("follows the server setting, never the anchor message author's personal override", () => {
    const turnFor = (borrowsTriggerMessage: boolean) =>
      ({
        persona: createPersona({ config: { deliberate_tool_mode: false } }),
        userRow: createUserRow({ personal_deliberate_tool_mode: "on" }),
        lockedTurn: { admission: { incoming: { borrowsTriggerMessage } } },
      }) as unknown as ChatTurn;
    expect(resolveTurnDeliberateToolMode(turnFor(false))).toBe(true);
    expect(resolveTurnDeliberateToolMode(turnFor(true))).toBe(false);
  });
});
