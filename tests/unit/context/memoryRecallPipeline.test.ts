import type { EmbeddingRequest } from "@/types/provider/featureInterfaces";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { embeddingModelSchema, userSavedProviderConfigSchema, serverMemorySchema } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import * as ragAvailability from "@/utils/db/ragAvailability";
import { llmModelRepo, ragRepository, serverMemoryRepository } from "@/utils/db/repositories";
import { memoryDecayRepository } from "@/utils/db/repositories/MemoryDecayRepository";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";
import * as credentials from "@/utils/provider/credentialResolver";
import * as capabilities from "@/utils/provider/providerCapabilityResolver";
import * as spriteCache from "@/utils/cache/personaSpriteCache";
import * as presetCache from "@/utils/cache/stPresetCache";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { log } from "@/utils/misc/logger";
import { memoryGuard } from "@/utils/security/rateLimiter";
import { buildContext } from "@/utils/text/context/builder";
import { createMemoryRecall, persistMemoryRecall } from "@/utils/text/context/memoryRecall";
import { startQueryRetrieval } from "@/utils/text/context/queryRetrieval";
import { applyPromptLayoutInserts, PROMPT_LAYOUT } from "@/utils/text/context/promptLayout";
import type { BuildContextParams } from "@/utils/text/context/types";
import { formatMemoryWithId } from "@/utils/memory/memoryId";
import { MEMORY_RECALL_TIMEOUT_MS } from "@/utils/memory/memoryDecay";
import { charsToTokensText } from "@/utils/text/tokenEstimate";
import { createPersona } from "../../helpers/fixtures";
import { useEnvSandbox } from "../../helpers/env";

useEnvSandbox(["MEMORY_DECAY_ENABLED"]);

const model = embeddingModelSchema.parse({
  embedding_model_id: 3,
  provider: "openrouter",
  codename: "fixture-embedding",
  model_family: "fixture-family",
});
const savedConfig = userSavedProviderConfigSchema.parse({
  user_id: 7,
  assigned_capabilities: ["embedding"],
  enabled_capabilities: ["embedding"],
  provider: "openrouter",
  api_key: Buffer.from("fixture-ciphertext"),
  llm_id: null,
  diffusion_model_id: null,
  nai_diffusion_model_id: null,
  nai_preset_name: null,
  embedding_model_id: 3,
});
const resolved: credentials.ResolvedCredentials = {
  provider: "openrouter",
  apiKey: "fixture-secret",
  keyVersion: 1,
  source: "personal",
  savedConfig,
};
function row(id: number, decayDays: number, channelIds: string[] = []) {
  return serverMemorySchema.parse({
    server_memory_id: id,
    server_id: 1,
    persona_id: 1,
    persona_lineage_id: 100,
    user_id: 1,
    content: `Stored fact ${id}`,
    decay_days: decayDays,
    channel_disc_ids: channelIds,
    tags: [],
  });
}
function params(): BuildContextParams {
  const persona = createPersona({
    server_memories: ["stored"],
    reward_conditioning_enabled: false,
    punish_conditioning_enabled: false,
    config: {
      embedding_model_id: 3,
      channel_memory_enabled: true,
      tool_use_enabled: false,
      time_awareness_enabled: false,
    },
  });
  return {
    guildId: "111111111111111111",
    serverName: "Archive",
    serverDescription: null,
    channelId: "222222222222222222",
    channelName: "general",
    channelDesc: null,
    triggererName: "Juno",
    triggererFormattedName: "Juno",
    triggererAddressTerm: "",
    triggererUserId: 7,
    tomoriNickname: "Mirri",
    tomoriAttributes: [],
    tomoriConfig: persona.config,
    snapshot: { tomoriState: persona },
    client: { guilds: { cache: new Map() }, users: { cache: new Map() } } as unknown as Client,
    preparedParticipantContext: {
      discoveryPlan: {
        seeds: [],
        evidence: [],
        rejections: [],
        aliasReferenceDiagnostics: {
          evaluatedAliasCount: 0,
          acceptedAliasCount: 0,
          ambiguousAliasCount: 0,
          unmatchedAliasCount: 0,
        },
      },
      matrixUsers: new Map(),
      syntheticUsers: new Map(),
      messageProxyUsers: new Map(),
      publicPersonaProfiles: [],
      referencedUserRows: new Map(),
      referencedUserIds: new Set(),
      diagnostics: {},
    } as unknown as BuildContextParams["preparedParticipantContext"],
    simplifiedMessageHistory: [
      {
        id: "333333333333333333",
        authorId: "444444444444444444",
        authorType: "user",
        authorName: "Juno",
        content: "Tell me about the archive",
        imageAttachments: [],
        videoAttachments: [],
      },
    ],
  };
}
function text(item: StructuredContextItem | null | undefined): string {
  return item?.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("") ?? "";
}
function installSpies() {
  const embed = mock(async (request: EmbeddingRequest) => request.inputs.map(() => [1, 0, 0]));
  return {
    embed,
    capability: spyOn(capabilities, "resolveEmbeddingsCapability").mockResolvedValue({
      generateEmbeddings: embed,
      supportsEmbeddingTaskType: () => true,
    } as unknown as Awaited<ReturnType<typeof capabilities.resolveEmbeddingsCapability>>),
    credentials: spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(resolved),
    model: spyOn(llmModelRepo, "loadEmbeddingModelById").mockResolvedValue(model),
    available: spyOn(ragAvailability, "isRagAvailable").mockReturnValue(true),
    memory: spyOn(memoryGuard, "getStatus").mockReturnValue("safe"),
    documents: spyOn(serverMemoryRepository, "hasDocumentInScope").mockResolvedValue(false),
    retrieve: spyOn(ragRepository, "retrieveRelevantChunks").mockResolvedValue([]),
    memories: spyOn(serverMemoryRepository, "loadServerMemoriesScoped").mockResolvedValue([
      row(1, 0),
      row(2, 14),
      row(3, 22),
      row(4, 14, ["555555555555555555"]),
    ]),
    score: spyOn(memoryDecayRepository, "scoreCandidates").mockResolvedValue([
      { kind: "server", id: 1, similarity: 1 },
      { kind: "server", id: 2, similarity: 0.8 },
      { kind: "server", id: 3, similarity: 0.5 },
    ]),
    missing: spyOn(memoryDecayRepository, "findMissingVectors").mockResolvedValue([]),
    day: spyOn(memoryDecayRepository, "recordRecallDay").mockResolvedValue([
      { kind: "server", id: 2, previous_decay_days: 14, decay_days: 0 },
      { kind: "server", id: 3, previous_decay_days: 22, decay_days: 0 },
    ]),
    upsert: spyOn(memoryDecayRepository, "upsertVector").mockResolvedValue(true),
    sprites: spyOn(spriteCache, "getCachedPersonaSprites").mockResolvedValue([]),
    preset: spyOn(presetCache, "getCachedActivePreset").mockResolvedValue(null),
    lore: spyOn(lorebookRepository, "loadEnabledForScope").mockResolvedValue([]),
    metric: spyOn(log, "metric").mockImplementation(() => {}),
    warn: spyOn(log, "warn").mockImplementation(() => {}),
    error: spyOn(log, "error").mockResolvedValue(undefined),
    sample: spyOn(metricSampleRepository, "recordSample").mockResolvedValue(undefined),
  };
}
let spies: ReturnType<typeof installSpies>;
beforeEach(() => {
  process.env.MEMORY_DECAY_ENABLED = "true";
  spies = installSpies();
});
afterEach(() => {
  for (const spy of Object.values(spies)) if ("mockRestore" in spy) spy.mockRestore();
});
async function persisted(buildParams = params()) {
  const built = await buildContext(buildParams);
  if (!built.memoryRecall) throw new Error("Missing recall outcome");
  await persistMemoryRecall(built.memoryRecall);
  const samples = spies.sample.mock.calls.filter(([name]) => name === "memory_recall");
  expect(samples).toHaveLength(1);
  return { built, fields: samples[0][1] };
}

describe("memory recall pipeline", () => {
  it("keeps active bytes and scoped candidates, recalls only dormant winners, and performs no writes during inspection assembly", async () => {
    const built = await buildContext(params());
    const system = built.contextItems.find((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_SERVER_MEMORIES);
    expect(text(system)).toContain(formatMemoryWithId(1, row(1, 0).content));
    expect(system?.memoryEntries?.map((memory) => memory.id)).toEqual(["server:1"]);
    const recalled = built.contextItems.find((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_RECALLED_MEMORIES);
    expect(text(recalled)).toContain(formatMemoryWithId(2, row(2, 14).content));
    expect(text(recalled)).not.toContain(formatMemoryWithId(1, row(1, 0).content));
    expect(built.memoryRecall?.recalled.length).toBeLessThanOrEqual(3);
    expect(spies.score.mock.calls[0][2].serverMemoryIds).toEqual([1, 2, 3]);
    expect(spies.day).not.toHaveBeenCalled();
    expect(spies.upsert).not.toHaveBeenCalled();
    expect(spies.sample.mock.calls.filter(([name]) => name === "memory_recall")).toHaveLength(0);
    expect(spies.credentials.mock.calls[0][2]).toEqual({ userId: 7 });
  });

  it("uses one early embedding for documents and memories and preserves tail layout", async () => {
    spies.documents.mockResolvedValue(true);
    spies.retrieve.mockResolvedValue([
      { document_id: 1, document_name: "Archive", chunk_index: 0, content: "A document", similarity: 0.9 },
    ]);
    const built = await buildContext(params());
    expect(spies.embed).toHaveBeenCalledTimes(1);
    expect(spies.retrieve.mock.calls[0][0].queryEmbedding).toEqual([1, 0, 0]);
    expect(spies.score.mock.calls[0][0]).toEqual([1, 0, 0]);
    applyPromptLayoutInserts(built.contextItems, []);
    const tags = built.contextItems.map((item) => item.metadataTag);
    expect(
      tags.indexOf(ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS) -
        tags.indexOf(ContextItemTag.KNOWLEDGE_RECALLED_MEMORIES),
    ).toBe(1);
    expect(PROMPT_LAYOUT.find((entry) => entry.tag === ContextItemTag.KNOWLEDGE_RECALLED_MEMORIES)).toMatchObject({
      zone: "tail",
      volatility: "turn",
    });
  });

  it("preserves recalled tail items and the read-only outcome through preset reassembly", async () => {
    spies.preset.mockResolvedValue({
      preset: { preset_id: 1, server_id: 1, preset_name: "Recall preset", raw_json: {}, is_active: true },
      nodes: ["main", "worldInfoBefore", "chatHistory"].map((identifier, index) => ({
        preset_id: 1,
        identifier,
        name: identifier,
        role: "system",
        content: "",
        is_marker: true,
        is_enabled: true,
        is_comment: false,
        node_order: index,
        injection_position: 0,
        injection_depth: 0,
        injection_order: 100,
      })),
    });
    const built = await buildContext(params());
    expect(built.memoryRecall?.outcome).toBe("scored");
    expect(
      built.nativeContextItems?.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_RECALLED_MEMORIES),
    ).toBe(true);
    expect(built.contextItems.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_RECALLED_MEMORIES)).toBe(
      true,
    );
    expect(spies.day).not.toHaveBeenCalled();
    expect(spies.upsert).not.toHaveBeenCalled();
  });

  it("keeps cached memory blocks identical when only recalled winners or rank change", async () => {
    const first = await buildContext(params());
    spies.score.mockResolvedValue([{ kind: "server", id: 3, similarity: 0.9 }]);
    const second = await buildContext(params());
    expect(text(first.contextItems.find((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_SERVER_MEMORIES))).toBe(
      text(second.contextItems.find((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_SERVER_MEMORIES)),
    );
    expect(
      text(first.contextItems.find((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_RECALLED_MEMORIES)),
    ).not.toBe(
      text(second.contextItems.find((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_RECALLED_MEMORIES)),
    );
    spies.score.mockResolvedValue([
      { kind: "server", id: 3, similarity: 0.9 },
      { kind: "server", id: 2, similarity: 0.8 },
    ]);
    const third = await buildContext(params());
    expect(
      text(first.contextItems.find((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_RECALLED_MEMORIES)),
    ).toBe(text(third.contextItems.find((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_RECALLED_MEMORIES)));
  });

  it("counts every vector-backed candidate, fills raw missing content after assembly, and emits numeric aggregates without identities", async () => {
    spies.memories.mockResolvedValue([row(1, 0), row(2, 14), row(3, 22), row(5, 14)]);
    spies.missing.mockResolvedValue([{ kind: "server", id: 5, content: "{bot} keeps raw stored content" }]);
    const { built, fields } = await persisted();
    expect(spies.day.mock.calls[0]).toEqual([
      { serverMemoryIds: [1, 2, 3], personalMemoryIds: [] },
      { serverMemoryIds: [1, 2, 3], personalMemoryIds: [] },
    ]);
    expect(spies.embed.mock.calls[1][0].inputs).toEqual(["{bot} keeps raw stored content"]);
    expect(spies.embed.mock.calls.map(([request]) => request.taskType)).toEqual([
      "RETRIEVAL_QUERY",
      "RETRIEVAL_DOCUMENT",
    ]);
    expect(spies.embed.mock.calls.every(([request]) => request.apiKey === resolved.apiKey)).toBe(true);
    expect(spies.upsert.mock.calls[0].slice(1)).toEqual([
      model.model_family,
      Number(model.embedding_model_id),
      [1, 0, 0],
      "{bot} keeps raw stored content",
    ]);
    expect(fields).toMatchObject({
      outcome: "scored",
      candidate_count: 4,
      scored_count: 3,
      recalled_count: 2,
      reinforced_count: 3,
      quick_return_count: 1,
      filled_count: 1,
      fill_tokens: charsToTokensText("{bot} keeps raw stored content".length),
    });
    expect(Object.keys(fields).sort()).toEqual(
      [
        "outcome",
        "total_ms",
        "embedding_ms",
        "candidate_count",
        "scored_count",
        "recalled_count",
        "reinforced_count",
        "quick_return_count",
        "dormant_tokens",
        "recalled_tokens",
        "query_tokens",
        "filled_count",
        "fill_tokens",
        "persistence_failed",
      ].sort(),
    );
    expect(fields.dormant_tokens).toBe(built.memoryRecall?.dormantTokens ?? 0);
    expect(fields.recalled_tokens).toBe(built.memoryRecall?.recalledTokens ?? 0);
    expect(Object.entries(fields).filter(([key, value]) => key !== "outcome" && typeof value !== "number")).toEqual([]);
    expect(spies.metric.mock.calls.filter(([name]) => name === "memory_recall")).toHaveLength(1);
  });

  it("measures quick returns from the counter locked for reinforcement", async () => {
    spies.day.mockResolvedValue([{ kind: "server", id: 2, previous_decay_days: 22, decay_days: 0 }]);
    const { fields } = await persisted();
    expect(fields.quick_return_count).toBe(0);
  });

  it("makes no embedding call when there are neither documents nor candidates", async () => {
    spies.memories.mockResolvedValue([]);
    const { fields } = await persisted();
    expect(fields.outcome).toBe("no_candidates");
    expect(spies.embed).not.toHaveBeenCalled();
    expect(spies.credentials).not.toHaveBeenCalled();
    expect(spies.day).not.toHaveBeenCalled();
  });

  it("keeps memories active and records no_model without provider failures for missing embedding configuration", async () => {
    for (const failure of [
      new credentials.CredentialUnavailableError("unknown", "embedding", "missing_model_id"),
      new credentials.CredentialUnavailableError("openrouter", "embedding", "no_saved_config"),
      new credentials.PersonalProviderRequiredError("embedding"),
    ]) {
      spies.sample.mockClear();
      spies.credentials.mockRejectedValue(failure);
      const { built, fields } = await persisted();
      expect(fields.outcome).toBe("no_model");
      expect(built.memoryRecall?.embeddingResolved).toBe(false);
      expect(
        text(built.contextItems.find((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_SERVER_MEMORIES)),
      ).toContain(formatMemoryWithId(2, row(2, 14).content));
      expect(spies.warn.mock.calls.some(([, cause]) => cause === failure)).toBe(false);
    }
    expect(spies.embed).not.toHaveBeenCalled();
    expect(spies.metric.mock.calls.some(([name]) => name === "provider_failure")).toBe(false);
    expect(spies.day).not.toHaveBeenCalled();
  });

  it("uses personal embedding readiness even when the server has no embedding model", async () => {
    const buildParams = params();
    buildParams.tomoriConfig.embedding_model_id = null;
    const { built, fields } = await persisted(buildParams);
    expect(fields.outcome).toBe("scored");
    expect(built.memoryRecall?.embeddingResolved).toBe(true);
    expect(spies.embed.mock.calls[0][0].apiKey).toBe(resolved.apiKey);
  });

  it("continues reporting credential decryption failures", async () => {
    const error = new credentials.CredentialUnavailableError("openrouter", "embedding", "decryption_failed");
    spies.credentials.mockRejectedValue(error);
    const { fields } = await persisted();
    expect(fields.outcome).toBe("provider_error");
    expect(spies.warn.mock.calls.some(([, cause]) => cause === error)).toBe(true);
    expect(spies.metric.mock.calls.some(([name]) => name === "provider_failure")).toBe(true);
  });

  it.each([
    "score",
    "missing",
  ] as const)("logs the error when recall %s fails without losing embedding readiness", async (operation) => {
    const error = new Error("fixture database failure");
    spies[operation].mockRejectedValue(error);
    const { built, fields } = await persisted();
    expect(fields.outcome).toBe("provider_error");
    expect(built.memoryRecall?.embeddingResolved).toBe(true);
    expect(spies.warn.mock.calls.some(([, cause]) => cause === error)).toBe(true);
  });

  it("leaves memories active with the switch off or pgvector unavailable, while switch-off document retrieval still works", async () => {
    for (const mode of ["disabled", "rag_unavailable"] as const) {
      process.env.MEMORY_DECAY_ENABLED = mode === "disabled" ? "false" : "true";
      spies.available.mockReturnValue(mode !== "rag_unavailable");
      const built = await buildContext(params());
      expect(
        text(built.contextItems.find((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_SERVER_MEMORIES)),
      ).toContain(formatMemoryWithId(2, row(2, 14).content));
      expect(built.memoryRecall?.outcome).toBe(mode);
      expect(spies.embed).not.toHaveBeenCalled();
      expect(spies.day).not.toHaveBeenCalled();
    }
    process.env.MEMORY_DECAY_ENABLED = "false";
    spies.available.mockReturnValue(true);
    spies.documents.mockResolvedValue(true);
    await buildContext(params());
    expect(spies.embed).toHaveBeenCalledTimes(1);
    expect(spies.retrieve).toHaveBeenCalled();
  });

  it("withholds dormant memories on timeout, warns, emits one sample, and handles a later embedding rejection", async () => {
    const pending = Promise.withResolvers<number[][]>();
    spies.embed.mockImplementation(() => pending.promise);
    const unhandled: unknown[] = [];
    const handler = (error: unknown) => {
      unhandled.push(error);
    };
    process.on("unhandledRejection", handler);
    try {
      const startedAt = performance.now();
      const { built, fields } = await persisted();
      expect(performance.now() - startedAt).toBeLessThan(MEMORY_RECALL_TIMEOUT_MS + 1000);
      expect(fields.outcome).toBe("timeout");
      expect(typeof fields.embedding_ms).toBe("number");
      expect(built.memoryRecall?.recalled).toEqual([]);
      expect(
        text(built.contextItems.find((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_SERVER_MEMORIES)),
      ).not.toContain(formatMemoryWithId(2, row(2, 14).content));
      expect(spies.warn).toHaveBeenCalled();
      pending.reject(new Error("late provider failure"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
      expect(
        spies.error.mock.calls.filter(([message]) => /embedding|memory recall|memory vectors/i.test(message)),
      ).toEqual([]);
      expect(spies.day).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", handler);
    }
  });

  it("skips recall and persistence on provider failure and reports only warnings", async () => {
    spies.embed.mockRejectedValue(new Error("HTTP 429 quota refused"));
    const { built, fields } = await persisted();
    expect(fields.outcome).toBe("provider_error");
    expect(built.memoryRecall?.recalled).toEqual([]);
    expect(spies.warn).toHaveBeenCalled();
    expect(
      spies.error.mock.calls.filter(([message]) => /embedding|memory recall|memory vectors/i.test(message)),
    ).toEqual([]);
    expect(spies.day).not.toHaveBeenCalled();
  });

  it("emits a sample after failed post-turn writes settle", async () => {
    const accountingError = new Error("fixture accounting failure");
    const fillError = new Error(`fixture fill failure ${resolved.apiKey}`);
    spies.day.mockRejectedValue(accountingError);
    spies.missing.mockResolvedValue([{ kind: "server", id: 5, content: "raw fact" }]);
    spies.upsert.mockRejectedValue(fillError);
    const { fields } = await persisted();
    expect(fields).toMatchObject({ persistence_failed: 1, filled_count: 0, fill_tokens: 0 });
    expect(spies.warn.mock.calls.some(([, cause]) => cause === accountingError)).toBe(true);
    expect(spies.warn.mock.calls.find(([, cause]) => cause === fillError)?.[3]?.redactValues).toContain(
      resolved.apiKey,
    );
    expect(
      spies.error.mock.calls.filter(([message]) => /embedding|memory recall|memory vectors/i.test(message)),
    ).toEqual([]);
  });

  it("logs the error when the recall metric sink fails", async () => {
    const built = await buildContext(params());
    if (!built.memoryRecall) throw new Error("Missing recall outcome");
    const error = new Error("fixture metric failure");
    spies.sample.mockRejectedValue(error);
    await persistMemoryRecall(built.memoryRecall);
    expect(spies.warn.mock.calls.some(([, cause]) => cause === error)).toBe(true);
  });

  it("attributes personal recall lines to their participant", async () => {
    const demand = Promise.withResolvers<boolean>();
    const buildParams = params();
    const retrieval = startQueryRetrieval(
      {
        tomoriState: buildParams.snapshot?.tomoriState,
        simplifiedMessageHistory: buildParams.simplifiedMessageHistory,
      },
      { enabled: true, demand: demand.promise },
    );
    const recall = createMemoryRecall(retrieval, demand.resolve);
    const line = `- Memories about Juno: ${formatMemoryWithId(9, "A personal fact")}`;
    expect(await recall.include({ kind: "personal", id: 9, decayDays: 14, line })).toBe(false);
    spies.score.mockResolvedValue([{ kind: "personal", id: 9, similarity: 0.5 }]);
    const recalled = await recall.finish();
    expect(text(recalled.item)).toContain(line);
  });
});
