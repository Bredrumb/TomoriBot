import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { CompactConversationResult } from "@/types/provider/featureInterfaces";
import * as featureExecutors from "@/providers/utils/providerFeatureExecutors";
import * as stm from "@/utils/cache/shortTermMemoryCache";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
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
import { createHash } from "node:crypto";

const userId = "1400000000000000001";
const channelId = "1400000000000000002";
const serverId = "1400000000000000003";
const marker = 1700000000000;
const replyTime = marker + 3000;
const apiKey = "fixture-rotation-key";
const category = { server_id: 1, position: 0, label: "summary", description: "Track open questions." };

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
    internalServerId: 1,
    answeringAttempt: {
      providerName: "openrouter",
      providerConfig: { apiKey, model: "openai/gpt-4.1-mini" },
      activity: { references: [], requestKeyDigest: createHash("sha256").update(apiKey).digest("hex") },
      usageContext: {},
      credentialSource: "server",
    },
    history: [historyMessage("Earlier question", marker), historyMessage("New question", marker + 1000)],
    replies: [{ speakerName: "Mirri", content: "New answer", timestamp: replyTime }],
    ready: Promise.resolve(),
    ...overrides,
  } satisfies Parameters<typeof startStmSummarizer>[0];
}

describe("background STM summaries", () => {
  const configMocks: { mockRestore(): void }[] = [];
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
    configMocks.push(
      spyOn(shortTermMemoryRepository, "getStmConfig").mockResolvedValue(null),
      spyOn(shortTermMemoryRepository, "getStmCategories").mockResolvedValue([category]),
    );
  });

  afterEach(() => {
    stm.invalidateShortTermMemory(userId, channelId, 1);
    for (const spy of configMocks.splice(0)) spy.mockRestore();
  });

  it("starts one request per due scope and forwards the answering key, activity, and usage", async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<CompactConversationResult>();
    const request = createRequest();
    const usage = { costUsd: 0.001, inputTokens: 20, outputTokens: 5 };
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
        { modelCodename: request.answeringAttempt.providerConfig.model, ...usage },
      ]);
      response.resolve({ summary: "  Updated {unknown_var} memory  " });
      await run;
      expect(provider).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(
        request,
        expect.objectContaining({ summary: "Previous memory", summarizedThrough: marker }),
        { summary: "Updated unknown_var memory" },
        replyTime,
      );
    } finally {
      response.resolve({});
      stopReporting();
      provider.mockRestore();
      write.mockRestore();
    }
  });

  it("retains the memory, cursor, and counter when the provider denies the request", async () => {
    const request = createRequest();
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
      expect(stm.getShortTermMemoryForUserChannel(userId, channelId, 1)).toMatchObject({
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

  it("discards a result after a manual change while the request was in flight", async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<CompactConversationResult>();
    const provider = spyOn(featureExecutors, "generateConversationSummaryForProvider").mockImplementation(() => {
      started.resolve();
      return response.promise;
    });
    const write = spyOn(stm, "persistStmSummarization").mockResolvedValue(undefined);
    try {
      const run = startStmSummarizer(createRequest());
      await started.promise;
      const entry = stm.getShortTermMemoryForUserChannel(userId, channelId, 1);
      if (!entry) throw new Error("Missing STM fixture");
      entry.summary = "Manual edit";
      response.resolve({ summary: "Stale output" });
      await run;

      expect(write).not.toHaveBeenCalled();
      expect(entry).toMatchObject({ summary: "Manual edit", turnsSinceRefresh: DEFAULT_STM_REFRESH_CADENCE });
    } finally {
      response.resolve({});
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
