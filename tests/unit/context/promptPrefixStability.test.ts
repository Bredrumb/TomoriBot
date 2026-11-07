import * as embeddingCapabilities from "@/utils/provider/providerCapabilityResolver";
import { memoryDecayRepository } from "@/utils/db/repositories/MemoryDecayRepository";
import { afterEach, expect, it, setSystemTime, spyOn } from "bun:test";
import { ActivityType, type Activity } from "discord.js";
import { AnthropicStreamAdapter } from "@/providers/anthropic/anthropicStreamAdapter";
import { GoogleStreamAdapter } from "@/providers/google/googleStreamAdapter";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { VertexStreamAdapter } from "@/providers/vertex/vertexStreamAdapter";
import { buildOpenAICompatibleMessages } from "@/providers/openaiCompatible/openaiCompatibleMessageBuilder";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { lorebookEntryRowSchema } from "@/modules/lorebooks/db/types";
import { embeddingModelSchema, savedProviderConfigSchema } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import * as spriteCache from "@/utils/cache/personaSpriteCache";
import * as stm from "@/utils/cache/shortTermMemoryCache";
import { invalidateStPresetCache } from "@/utils/cache/stPresetCache";
import { llmModelRepo, mcpRepository, ragRepository, serverMemoryRepository } from "@/utils/db/repositories";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";
import * as ragAvailability from "@/utils/db/ragAvailability";
import * as credentialResolver from "@/utils/provider/credentialResolver";
import { memoryGuard } from "@/utils/security/rateLimiter";
import { log } from "@/utils/misc/logger";
import { selectAnchoredHistory, setHistoryWindowGatewayConnected } from "@/utils/chat/historyWindow";
import { buildContext } from "@/utils/text/context/builder";
import { applyPromptLayoutInserts, getCacheablePrefixBoundary } from "@/utils/text/context/promptLayout";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";
import { prepareParticipantContext } from "@/utils/text/participants/preparation";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { createParticipantContextFixture, PARTICIPANT_FIXTURE_IDS as IDS } from "./fixtures/participantContextFixture";

type SerializedPrompt = { system?: unknown; messages: unknown[] };
type Serializer = (items: StructuredContextItem[]) => Promise<SerializedPrompt>;

const serializers: Record<string, Serializer> = {
  openrouter: async (items) => ({
    messages: await new OpenrouterStreamAdapter().buildProbeMessages(items, false, false),
  }),
  anthropic: async (items) => new AnthropicStreamAdapter().buildProbeMessages(items, false),
  google: async (items) => {
    const payload = await new GoogleStreamAdapter().buildTokenCountPayload(items, "gemini-3.5-flash-lite");
    return { system: payload.systemInstruction, messages: payload.contents };
  },
  vertex: async (items) => {
    const payload = await new VertexStreamAdapter().buildTokenCountPayload(items, "gemini-3.5-flash-lite");
    return { system: payload.systemInstruction, messages: payload.contents };
  },
  openaiCompatible: async (items) => ({
    messages: await buildOpenAICompatibleMessages({
      adapterName: "custom",
      contextItems: items,
      currentTurnModelParts: [],
    }),
  }),
};

const epoch = Date.UTC(2026, 0, 1, 12);

function history(turns: number): SimplifiedMessageForContext[] {
  return Array.from({ length: turns }, (_, index) => ({
    id: String(700000000000000000n + BigInt(index)),
    authorId: index % 2 ? IDS.bot : IDS.human,
    authorName: index % 2 ? "Tomori" : "Alice Saved",
    authorType: index % 2 ? "persona" : "user",
    personaName: index % 2 ? "Tomori" : undefined,
    content: `Conversation ${index}: maps, lantern, harbor.`,
    createdAt: epoch - (30 - index) * 60_000,
    imageAttachments: [],
    videoAttachments: [],
  }));
}

function lastString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  return Object.values(value)
    .map(lastString)
    .filter((text) => text !== undefined)
    .at(-1);
}

async function serializedPrefix(items: StructuredContextItem[], serialize: Serializer): Promise<string> {
  const boundary = getCacheablePrefixBoundary(items);
  if (!boundary) throw new Error("Fixture has no cacheable prefix");
  const projected = await serialize(items.slice(0, items.indexOf(boundary) + 1));
  const bytes = JSON.stringify(projected);
  const text = lastString(projected.messages);
  if (!text) throw new Error("Serialized prefix has no terminal text");
  const encoded = JSON.stringify(text);
  return bytes.slice(0, bytes.lastIndexOf(encoded) + encoded.length - 1);
}

function textFor(items: StructuredContextItem[], tag: ContextItemTag): string {
  return items
    .filter((item) => item.metadataTag === tag)
    .flatMap((item) => item.parts)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

afterEach(() => {
  setSystemTime();
  invalidateStPresetCache(1);
  setHistoryWindowGatewayConnected(0, true);
});

it("preserves serialized prefixes across volatile updates and appended exchanges on every path and adapter", async () => {
  const fixture = createParticipantContextFixture();
  const persona = createPersona({
    persona_id: IDS.activePersona,
    persona_lineage_id: IDS.activeLineage,
    persona_nickname: "Tomori",
    reward_conditioning_enabled: false,
    punish_conditioning_enabled: false,
    llm: createLlmRow({ has_tools: false }),
    config: {
      system_prompt: "Conversation instructions",
      personal_memories_enabled: true,
      memory_tagging_enabled: false,
      embedding_model_id: 3,
      tool_use_enabled: false,
      short_term_memory_enabled: false,
      emoji_usage_enabled: false,
      sticker_usage_enabled: false,
      time_awareness_enabled: true,
      timezone_offset: 8,
    },
  });
  const user = fixture.users.get(IDS.human);
  const member = fixture.memberCache.get(IDS.human);
  const guild = fixture.client.guilds.cache.get(IDS.guild);
  if (!user || !member || !guild) throw new Error("Participant fixture is missing its user or guild");
  user.timezone_offset = 5.5;
  Object.assign(guild, { presences: { cache: new Map() } });
  const activity = {
    type: ActivityType.Listening,
    name: "Spotify",
    details: "Lantern song",
    state: "Juno",
    timestamps: { start: new Date(epoch - 192_000), end: null },
  } as Activity;
  Object.assign(member, { presence: { status: "online", activities: [activity] } });
  const intent = spyOn(fixture.client.options.intents, "has").mockReturnValue(true);
  let variant = 0;
  let preset = false;
  let roll = 0;
  const spies = [
    intent,
    spyOn(spriteCache, "getCachedPersonaSprites").mockResolvedValue([]),
    spyOn(log, "info").mockImplementation(() => undefined),
    spyOn(log, "warn").mockImplementation(() => undefined),
    spyOn(log, "metric").mockImplementation(() => undefined),
    spyOn(metricSampleRepository, "recordSample").mockResolvedValue(undefined),
    spyOn(mcpRepository, "loadGuildMcpConfigs").mockResolvedValue([]),
    spyOn(serverMemoryRepository, "loadServerMemoriesScoped").mockResolvedValue([]),
    spyOn(shortTermMemoryRepository, "getStmConfig").mockResolvedValue(null),
    spyOn(shortTermMemoryRepository, "getStmCategories").mockResolvedValue([]),
    spyOn(stm, "preWarmServerStmEntries").mockResolvedValue(undefined),
    spyOn(stm, "preWarmStmEntry").mockResolvedValue(undefined),
    spyOn(stm, "getShortTermMemoryForServerChannel").mockReturnValue(undefined),
    spyOn(stm, "getShortTermMemoriesForServer").mockImplementation(() => [
      {
        serverId: IDS.guild,
        channelId: "200000000000000002",
        channelName: "workshop",
        messages: [],
        lastUpdated: epoch,
        summary: `Other-channel plan ${variant}`,
      },
    ]),
    spyOn(ragAvailability, "isRagAvailable").mockReturnValue(true),
    spyOn(memoryGuard, "getStatus").mockReturnValue("safe"),
    spyOn(serverMemoryRepository, "hasDocumentInScope").mockResolvedValue(true),
    spyOn(credentialResolver, "resolveCapabilityCredentials").mockResolvedValue({
      provider: "openrouter",
      apiKey: "fixture-key",
      keyVersion: 1,
      source: "server",
      savedConfig: savedProviderConfigSchema.parse({
        server_id: 1,
        provider: "openrouter",
        api_key: Buffer.from("fixture-key"),
        llm_id: null,
        diffusion_model_id: null,
        embedding_model_id: 3,
        nai_diffusion_model_id: null,
        nai_preset_name: null,
        llm_disabled_params: [],
        llm_logit_biases: [],
        fallback_model_refs: [],
      }),
    }),
    spyOn(llmModelRepo, "loadEmbeddingModelById").mockResolvedValue(
      embeddingModelSchema.parse({
        embedding_model_id: 3,
        provider: "openrouter",
        codename: "fixture-embedding",
        model_family: "fixture",
      }),
    ),
    spyOn(embeddingCapabilities, "resolveEmbeddingsCapability").mockResolvedValue({
      generateEmbeddings: async () => [[1, 0]],
      supportsEmbeddingTaskType: () => true,
    } as unknown as Awaited<ReturnType<typeof embeddingCapabilities.resolveEmbeddingsCapability>>),
    spyOn(memoryDecayRepository, "scoreCandidates").mockResolvedValue([]),
    spyOn(memoryDecayRepository, "findMissingVectors").mockResolvedValue([]),
    spyOn(ragRepository, "retrieveRelevantChunks").mockImplementation(async () => [
      {
        document_id: variant + 1,
        document_name: `Atlas ${variant}`,
        chunk_index: 0,
        content: `Retrieved route ${variant}`,
        similarity: 0.9,
      },
    ]),
    spyOn(lorebookRepository, "loadEnabledForScope").mockResolvedValue([
      ...[0, 1].map((placement) =>
        lorebookEntryRowSchema.parse({
          entry_id: placement + 1,
          server_id: 1,
          persona_lineage_id: IDS.activeLineage,
          title: `Constant ${placement}`,
          content: `World rule ${placement}`,
          keys: [],
          secondary_keys: [],
          selective_logic: 0,
          scan_depth: 5,
          trigger_chance: 100,
          insertion_order: placement,
          placement,
          constant: true,
          enabled: true,
          channel_disc_ids: [],
        }),
      ),
      ...["lantern", "harbor"].map((key, index) =>
        lorebookEntryRowSchema.parse({
          entry_id: index + 3,
          server_id: 1,
          persona_lineage_id: IDS.activeLineage,
          title: key,
          content: `Activated ${key}`,
          keys: [key],
          secondary_keys: [],
          selective_logic: 0,
          scan_depth: 5,
          trigger_chance: 50,
          insertion_order: 10 + index,
          placement: index,
          constant: false,
          enabled: true,
          channel_disc_ids: [],
        }),
      ),
    ]),
    spyOn(Math, "random").mockImplementation(() => (roll++ % 2 === variant ? 0.1 : 0.9)),
    spyOn(presetRepository, "loadActivePreset").mockImplementation(async () =>
      preset
        ? {
            preset_id: 1,
            server_id: 1,
            preset_name: "Stable conversation",
            raw_json: {},
            is_active: true,
          }
        : null,
    ),
    spyOn(presetRepository, "loadAllNodes").mockResolvedValue([
      {
        preset_id: 1,
        identifier: "system",
        name: "Instructions",
        role: "system",
        content: "Preset instructions",
        is_marker: false,
        is_enabled: true,
        is_comment: false,
        node_order: 0,
        injection_position: 0,
        injection_depth: 0,
        injection_order: 100,
      },
      ...["worldInfoBefore", "main", "charPersonality", "worldInfoAfter", "chatHistory"].map((identifier, index) => ({
        preset_id: 1,
        identifier,
        name: identifier,
        role: "system" as const,
        content: "",
        is_marker: true,
        is_enabled: true,
        is_comment: false,
        node_order: index + 1,
        injection_position: 0,
        injection_depth: 0,
        injection_order: 100,
      })),
    ]),
  ];
  async function build(messages: SimplifiedMessageForContext[], change: number) {
    variant = change;
    roll = 0;
    setSystemTime(epoch + change * 60_000);
    activity.details = change ? "Harbor song" : "Lantern song";
    invalidateStPresetCache(1);
    const prepared = await prepareParticipantContext({
      client: fixture.client,
      guildId: IDS.guild,
      simplifiedMessageHistory: messages,
      personas: [persona],
      activePersona: persona,
      visibleUserIds: [...new Set(messages.map((message) => message.authorId))],
    });
    const result = await buildContext({
      guildId: IDS.guild,
      serverName: "Workshop",
      serverDescription: null,
      simplifiedMessageHistory: messages,
      preparedParticipantContext: prepared,
      channelDesc: null,
      channelName: "general",
      channelId: IDS.channel,
      client: fixture.client,
      triggererName: "Alice Saved",
      triggererFormattedName: "Alice Saved",
      triggererAddressTerm: "",
      tomoriNickname: "Tomori",
      tomoriAttributes: [],
      tomoriConfig: persona.config,
      snapshot: { tomoriState: persona, triggererUserRow: fixture.users.get(IDS.human) },
      preloadedEmojis: [],
      preloadedStickers: [],
      preloadedCustomExpressions: [],
    });
    applyPromptLayoutInserts(result.contextItems, [
      { tag: "stm_content", items: result.memoryInjectionItems ?? [], depth: result.memoryInjectionDepth },
      { tag: "stm_nudge", items: result.nudgeItem ? [result.nudgeItem] : [], depth: result.nudgeInjectionDepth },
    ]);
    return result.contextItems;
  }
  const failures: string[] = [];
  try {
    selectAnchoredHistory("prefix-full-window", history(80), 80);
    const anchored = Array.from({ length: 13 }, (_, index) =>
      selectAnchoredHistory("prefix-full-window", history(82 + index * 2).slice(-80), 80),
    );
    expect(anchored[0]?.[0]?.id).toBe(history(82)[24]?.id);
    expect(anchored[11]?.[0]?.id).toBe(anchored[0]?.[0]?.id);
    expect(anchored[12]?.[0]?.id).toBe(history(106)[48]?.id);
    const cases = [
      { name: "growing history", first: history(11), next: history(13) },
      ...anchored.slice(0, 11).map((first, index) => ({
        name: `full window exchange ${index + 1}`,
        first,
        next: anchored[index + 1] ?? [],
      })),
    ];
    for (const path of ["native", "preset"]) {
      preset = path === "preset";
      for (const scenario of cases) {
        const first = await build(scenario.first, 0);
        const changed = await build(scenario.first, 1);
        const appended = await build(scenario.next, 1);
        for (const tag of [
          ContextItemTag.KNOWLEDGE_USER_STATUS,
          ContextItemTag.KNOWLEDGE_CURRENT_CONTEXT,
          ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
          ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
        ]) {
          if (!textFor(first, tag) || textFor(first, tag) === textFor(changed, tag))
            failures.push(`${path}: unchanged ${tag}`);
        }
        const activeLore = (items: StructuredContextItem[]) =>
          items.filter(
            (item) =>
              item.role === "user" &&
              [ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE, ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER].includes(
                item.metadataTag ?? ContextItemTag.DIALOGUE_HISTORY,
              ),
          );
        if (JSON.stringify(activeLore(first)) === JSON.stringify(activeLore(changed)))
          failures.push(`${path}: unchanged lore`);
        for (const [adapter, serialize] of Object.entries(serializers)) {
          const label = `${scenario.name}/${path}/${adapter}`;
          try {
            const prefix = await serializedPrefix(first, serialize);
            const changedPrefix = await serializedPrefix(changed, serialize);
            const full = JSON.stringify(await serialize(first));
            const updated = JSON.stringify(await serialize(changed));
            const extended = JSON.stringify(await serialize(appended));
            if (!full.startsWith(prefix))
              failures.push(`${label}: boundary projection differs from full serialization`);
            if (prefix !== changedPrefix || !updated.startsWith(prefix))
              failures.push(`${label}: volatile prefix changed`);
            if (!extended.startsWith(prefix)) failures.push(`${label}: appended exchange changed prefix`);
          } catch (error) {
            failures.push(`${label}: ${String(error)}`);
          }
        }
      }
    }
  } finally {
    for (const spy of spies) spy.mockRestore();
    fixture.restoreRepositories();
  }
  expect(failures).toEqual([]);
});
