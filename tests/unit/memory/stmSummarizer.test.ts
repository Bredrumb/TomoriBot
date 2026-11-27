import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { serverStmConfigSchema } from "@/types/db/schema";
import type { CompactConversationResult } from "@/types/provider/featureInterfaces";
import * as featureExecutors from "@/providers/utils/providerFeatureExecutors";
import * as stm from "@/utils/cache/shortTermMemoryCache";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { statRepository } from "@/utils/db/repositories/StatRepository";
import { DEFAULT_STM_REFRESH_CADENCE, parseStmCategories, startStmSummarizer } from "@/utils/memory/stmSummarizer";
import { log } from "@/utils/misc/logger";
import {
  currentProviderUsageContext,
  currentStoredCredentialActivity,
  ProviderRequestDeniedError,
  registerProviderUsageReporter,
} from "@/utils/provider/providerUsage";
import { buildSlugMap } from "@/utils/text/slugifyLabel";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";
import { charsToTokensText } from "@/utils/text/tokenEstimate";
import { createHash } from "node:crypto";

const userId = "1400000000000000001";
const channelId = "1400000000000000002";
const serverId = "1400000000000000003";
const marker = 1700000000000;
const apiKey = "fixture-rotation-key";
const category = { server_id: 1, position: 0, label: "summary", description: "Track open questions." };
const statScope = { serverId: 1, userId: 7, lineageId: 3, metricKey: "other-model" };

function historyMessage(content: string, createdAt: number): SimplifiedMessageForContext {
  return {
    id: String(createdAt),
    authorId: userId,
    authorName: "Juno",
    authorType: "user",
    content,
    createdAt,
    imageAttachments: [],
    videoAttachments: [],
  };
}

function createRequest(overrides: Partial<Parameters<typeof startStmSummarizer>[0]> = {}) {
  return {
    serverId: null,
    userId,
    channelId,
    personaId: 1,
    enabled: true,
    internalServerId: statScope.serverId,
    triggererUserId: statScope.userId,
    lineageId: statScope.lineageId,
    answeringAttempt: {
      providerName: "openrouter",
      modelCodename: statScope.metricKey,
      providerConfig: { apiKey, model: "openai/gpt-4.1-mini" },
      activity: { references: [], requestKeyDigest: createHash("sha256").update(apiKey).digest("hex") },
      usageContext: {},
      credentialSource: "server",
    },
    history: [
      { ...historyMessage("Earlier question", marker), authorId: "1400000000000000005", authorName: "Rye" },
      historyMessage("New question", marker + 1000),
    ],
    replies: [{ speakerName: "Mirri", content: "New answer" }],
    ready: Promise.resolve(),
    ...overrides,
  } satisfies Parameters<typeof startStmSummarizer>[0];
}

describe("background STM summaries", () => {
  const restores: { mockRestore(): void }[] = [];
  const stats = mock((_input: Parameters<typeof statRepository.recordStat>[0]) => {});
  let serverEntry: stm.ShortTermMemoryEntry;
  beforeEach(() => {
    stm.warmUserStmRows(
      [userId],
      [
        {
          scope_kind: "user",
          user_disc_id: userId,
          channel_disc_id: channelId,
          persona_id: 1,
          summary: "Previous memory",
          categories: {},
          summarized_through: new Date(marker),
          turns_since_refresh: DEFAULT_STM_REFRESH_CADENCE,
          last_refreshed_turn: 1,
        },
      ],
    );
    serverEntry = {
      messages: [],
      serverId,
      channelId,
      personaId: 1,
      summary: "Previous memory",
      summarizedThrough: marker,
      turnsSinceRefresh: DEFAULT_STM_REFRESH_CADENCE,
      lastRefreshedTurn: 1,
      lastUpdated: Date.now(),
    };
    stats.mockClear();
    restores.push(
      spyOn(shortTermMemoryRepository, "getStmConfig").mockResolvedValue(null),
      spyOn(shortTermMemoryRepository, "getStmCategories").mockResolvedValue([category]),
      spyOn(stm, "getShortTermMemoryForServerChannel").mockReturnValue(serverEntry),
      spyOn(statRepository, "recordStat").mockImplementation(stats),
    );
  });

  afterEach(() => {
    stm.invalidateShortTermMemory(userId, channelId, 1);
    for (const spy of restores.splice(0)) spy.mockRestore();
  });

  it("uses the fetched boundary for gaps and retains neutral voice with an override", async () => {
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    const provider = spyOn(featureExecutors, "generateConversationSummaryForProvider").mockResolvedValue({
      summary: "Updated",
    });
    const write = spyOn(stm, "persistStmSummarization").mockResolvedValue(undefined);
    restores.push(
      spyOn(shortTermMemoryRepository, "getStmConfig").mockResolvedValue(
        serverStmConfigSchema.parse({ server_id: 1, summarizer_instructions_override: "Track plans." }),
      ),
    );
    try {
      await startStmSummarizer(
        createRequest({
          fetchedHistoryOldestTimestamp: marker + 1000,
          history: [historyMessage("Old queued trigger", marker - 1000), historyMessage("New question", marker + 1000)],
        }),
      );
      expect(metric).toHaveBeenCalledWith("stm_summary_history_gap", { scopeKind: "user" });
      expect(provider.mock.calls[0][0].systemPrompt).toContain("neutral third person");
      expect(provider.mock.calls[0][0].systemPrompt).toContain("Track plans.");
    } finally {
      metric.mockRestore();
      provider.mockRestore();
      write.mockRestore();
    }
  });

  it("starts one request per due scope and forwards the answering key, activity, and usage", async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<CompactConversationResult>();
    const request = createRequest({ serverId });
    const usage = { costUsd: 0.001, inputTokens: 20, outputTokens: 5, cacheReadTokens: 9, cacheWriteTokens: 3 };
    const reported = Promise.withResolvers<unknown>();
    const stopReporting = registerProviderUsageReporter((context, report) => reported.resolve([context, report]));
    const provider = spyOn(featureExecutors, "generateConversationSummaryForProvider").mockImplementation((input) => {
      expect(currentProviderUsageContext()).toBe(request.answeringAttempt.usageContext);
      expect(currentStoredCredentialActivity()).toBe(request.answeringAttempt.activity);
      expect(input.apiKey).toBe(apiKey);
      expect(input.model).toBe(request.answeringAttempt.providerConfig.model);
      input.onUsage?.(usage);
      started.resolve();
      return response.promise;
    });
    const write = spyOn(stm, "persistStmSummarization").mockResolvedValue(undefined);
    try {
      const run = startStmSummarizer(request);
      expect(run).toBeDefined();
      await started.promise;

      expect(startStmSummarizer({ ...request })).toBeUndefined();
      const [{ userPrompt }] = provider.mock.calls[0];
      expect(JSON.parse(userPrompt)).toEqual({
        previousMemory: "Previous memory",
        newMessages: [
          { speakerName: "Juno", content: "New question" },
          { speakerName: "Mirri", content: "New answer" },
        ],
      });
      expect(await reported.promise).toEqual([
        request.answeringAttempt.usageContext,
        { modelCodename: request.answeringAttempt.modelCodename, ...usage },
      ]);
      response.resolve({ summary: "  Updated {unknown_var} memory  " });
      await run;
      expect(provider).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(
        request,
        expect.objectContaining({ summary: "Previous memory", summarizedThrough: marker }),
        { summary: "Updated unknown_var memory" },
        marker + 1000,
      );
      expect(stats.mock.calls.flat()).toEqual([
        { ...statScope, metric: "tokens_in", delta: 20 },
        { ...statScope, metric: "tokens_out", delta: 5 },
        { ...statScope, metric: "cache_read_tokens", delta: 9 },
        { ...statScope, metric: "cache_write_tokens", delta: 3 },
      ]);
    } finally {
      response.resolve({});
      stopReporting();
      provider.mockRestore();
      write.mockRestore();
    }
  });

  it("retains the memory, cursor, and counter when the provider denies the request without usage", async () => {
    const request = createRequest({ serverId });
    const denied = new ProviderRequestDeniedError(request.answeringAttempt.usageContext, () => ({
      titleKey: "general.errors.unknown_title",
      description: "",
    }));
    const provider = spyOn(featureExecutors, "generateConversationSummaryForProvider").mockResolvedValue({
      error: `HTTP 429: echoed ${apiKey}`,
      cause: denied,
    });
    const write = spyOn(stm, "persistStmSummarization").mockResolvedValue(undefined);
    const warn = spyOn(log, "warn").mockImplementation(() => {});
    try {
      await startStmSummarizer(request);
      expect(provider).toHaveBeenCalledTimes(1);
      expect(write).not.toHaveBeenCalled();
      expect(stats).not.toHaveBeenCalled();
      expect(serverEntry).toMatchObject({
        turnsSinceRefresh: DEFAULT_STM_REFRESH_CADENCE,
        summarizedThrough: marker,
        summary: "Previous memory",
      });
      expect(warn.mock.calls[0][0]).toContain("429");
      expect(warn.mock.calls[0][0]).not.toContain(apiKey);
    } finally {
      provider.mockRestore();
      write.mockRestore();
      warn.mockRestore();
    }
  });

  it("records estimated tokens even when a manual change discards the result", async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<CompactConversationResult>();
    const provider = spyOn(featureExecutors, "generateConversationSummaryForProvider").mockImplementation(() => {
      started.resolve();
      return response.promise;
    });
    const write = spyOn(stm, "persistStmSummarization").mockResolvedValue(undefined);
    try {
      const answeringAttempt = {
        ...createRequest().answeringAttempt,
        providerName: "google",
        modelCodename: "gemini-2.5-flash",
        providerConfig: { apiKey, model: "gemini-2.5-flash" },
      };
      const run = startStmSummarizer(createRequest({ serverId, answeringAttempt }));
      await started.promise;
      serverEntry.summary = "Manual edit";
      const summary = "Stale output";
      response.resolve({ summary });
      await run;

      expect(write).not.toHaveBeenCalled();
      expect(serverEntry).toMatchObject({ summary: "Manual edit", turnsSinceRefresh: DEFAULT_STM_REFRESH_CADENCE });
      const [{ systemPrompt, userPrompt }] = provider.mock.calls[0];
      const scope = { ...statScope, metricKey: answeringAttempt.modelCodename };
      expect(stats.mock.calls.flat()).toEqual([
        { ...scope, metric: "tokens_in", delta: charsToTokensText((systemPrompt?.length ?? 0) + userPrompt.length) },
        { ...scope, metric: "tokens_out", delta: charsToTokensText(summary.length) },
      ]);
    } finally {
      response.resolve({});
      provider.mockRestore();
      write.mockRestore();
    }
  });

  it.each([true, false])("omits server stats for a DM summary with provider usage %s", async (measured) => {
    const provider = spyOn(featureExecutors, "generateConversationSummaryForProvider").mockImplementation(
      async (input) => {
        if (measured) input.onUsage?.({ inputTokens: 20, outputTokens: 5 });
        return { summary: "Updated memory" };
      },
    );
    const write = spyOn(stm, "persistStmSummarization").mockResolvedValue(undefined);
    try {
      await startStmSummarizer(createRequest());
      expect(write).toHaveBeenCalled();
      expect(stats).not.toHaveBeenCalled();
    } finally {
      provider.mockRestore();
      write.mockRestore();
    }
  });

  it("includes a message that arrived during generation in the next summary", async () => {
    const first = createRequest({ serverId });
    const provider = spyOn(featureExecutors, "generateConversationSummaryForProvider").mockResolvedValue({
      summary: "Updated memory",
    });
    spyOn(shortTermMemoryRepository, "getStmConfig").mockResolvedValue(
      serverStmConfigSchema.parse({ server_id: statScope.serverId, refresh_cadence: 1 }),
    );
    const write = spyOn(stm, "persistStmSummarization").mockImplementation(
      async (_scope, _snapshot, content, cursor) => {
        Object.assign(serverEntry, content, { summarizedThrough: cursor, turnsSinceRefresh: 0 });
      },
    );
    try {
      await startStmSummarizer(first);
      expect(serverEntry.summarizedThrough).toBe(marker + 1000);

      serverEntry.turnsSinceRefresh = 1;
      const late = historyMessage("I remembered to bring a map.", marker + 2000);
      const question = first.history[1];
      const reply = first.replies[0];
      await startStmSummarizer(
        createRequest({
          serverId,
          history: [
            first.history[0],
            {
              ...question,
              content: `${question.content}\n${late.content}`,
              combinedMessageIds: [question.id, late.id],
              combinedCreatedAts: [marker + 1000, marker + 2000],
              individualContents: [question.content ?? "", late.content ?? ""],
            },
            {
              ...historyMessage(reply.content, marker + 3000),
              authorId: "1400000000000000004",
              authorName: reply.speakerName,
              authorType: "persona",
              personaName: reply.speakerName,
            },
          ],
          replies: [{ speakerName: "Mirri", content: "I'll bring a compass." }],
        }),
      );
      const [{ userPrompt }] = provider.mock.calls[1];
      expect(JSON.parse(userPrompt).newMessages).toContainEqual({ speakerName: "Juno", content: late.content });
      expect(JSON.parse(userPrompt).newMessages).toContainEqual(reply);
    } finally {
      provider.mockRestore();
      write.mockRestore();
    }
  });

  it("does not start a request when automatic STM is disabled for the server", async () => {
    const provider = spyOn(featureExecutors, "generateConversationSummaryForProvider");
    try {
      expect(startStmSummarizer(createRequest({ serverId, enabled: false }))).toBeUndefined();
      expect(provider).not.toHaveBeenCalled();
    } finally {
      provider.mockRestore();
    }
  });
});

describe("STM category output", () => {
  const categories = buildSlugMap([{ label: "Open Questions" }, { label: "Plans" }, { label: "People" }]);

  it("updates known sections, skips unknown sections, drops empty sections and keeps omitted ones", () => {
    const text = [
      "Preamble",
      "### Plans",
      "{unknown_var} visit",
      "### Unknown",
      "Should be ignored",
      "### Open Questions",
      "",
    ].join("\r\n");
    expect(parseStmCategories(text, categories, { open_questions: "Old", people: "Juno" })).toEqual({
      plans: "unknown_var visit",
      people: "Juno",
    });
    expect(parseStmCategories("### Plans\n\n", categories, { plans: "Old" })).toEqual({});
  });

  it("requires an exact known heading and caps the stored text", () => {
    expect(parseStmCategories("### plans\ntext\n### Plans \ntext", categories, {})).toBeUndefined();
    const parsed = parseStmCategories(`### Plans\n${"x".repeat(stm.MAX_SUMMARY_LENGTH + 1)}`, categories, {});
    expect(parsed?.plans).toHaveLength(stm.MAX_SUMMARY_LENGTH);
  });
});
