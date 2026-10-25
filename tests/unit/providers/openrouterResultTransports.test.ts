import { afterEach, describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { generateConversationSummaryOpenrouter } from "@/providers/openrouter/compactGenerator";
import { OpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { callOpenrouterStructuredJSON } from "@/providers/openrouter/openrouterStructuredOutput";
import { generatePresetFromPromptOpenrouter } from "@/providers/openrouter/presetGenerator";
import { extractHistoryWindowForProvider } from "@/providers/utils/providerFeatureExecutors";
import type { TokenUsage } from "@/utils/text/tokenEstimate";
import { stubGlobalFetch } from "../../helpers/fetchStub";

let fetchStub: ReturnType<typeof stubGlobalFetch> | null = null;

afterEach(() => {
  fetchStub?.mockRestore();
  fetchStub = null;
});

function rejectWithKeyLimit(status: 402 | 403) {
  fetchStub = stubGlobalFetch(() =>
    Response.json(
      { error: { code: status, message: "Key limit exceeded", metadata: { limit_source: "openrouter_key_limit" } } },
      { status },
    ),
  );
}

function answer(body: Record<string, unknown>) {
  fetchStub = stubGlobalFetch(() =>
    Response.json({ ...body, usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.002 } }),
  );
}

const usageOf = (onUsage: ReturnType<typeof mock>) => onUsage.mock.calls.map((call) => call[0] as TokenUsage);
const apiKey = "synthetic-api-key";

describe("OpenRouter result-object transports", () => {
  it("keeps the key limit on preset, summary, structured, and history failures", async () => {
    for (const status of [402, 403] as const) {
      rejectWithKeyLimit(status);
      const preset = await generatePresetFromPromptOpenrouter(
        apiKey,
        { characterName: "Mirri", characterDescription: "Fixture", speechExamples: "Hello" },
        "en-US",
        { model: "example/text-model" },
      );
      const summary = await generateConversationSummaryOpenrouter({
        apiKey,
        model: "example/text-model",
        userPrompt: "Summarize",
      });
      const structured = await callOpenrouterStructuredJSON(
        { apiKey, model: "example/text-model", systemPrompt: "", userPrompt: "Classify" },
        {},
        z.object({}),
        "fixture_result",
      );
      const history = await extractHistoryWindowForProvider({
        providerName: "openrouter",
        apiKey,
        model: "example/text-model",
        systemPrompt: "",
        userPrompt: "Extract",
      });
      for (const result of [preset, summary, structured, history]) {
        let cause: unknown = "cause" in result ? result.cause : undefined;
        while (cause instanceof Error && !(cause instanceof OpenRouterLimitError)) cause = cause.cause;
        expect(cause).toBeInstanceOf(OpenRouterLimitError);
        expect(cause).toMatchObject({
          limitSource: "openrouter_key_limit",
          status,
        });
      }
      fetchStub?.mockRestore();
    }
  });

  it("reports each response's charge to the caller", async () => {
    const onUsage = mock(() => undefined);
    answer({ choices: [] });
    await generatePresetFromPromptOpenrouter(
      apiKey,
      { characterName: "Mirri", characterDescription: "Fixture", speechExamples: "Hello" },
      "en-US",
      { model: "example/text-model", onUsage },
    );
    fetchStub?.mockRestore();
    answer({ choices: [{ message: { content: "Summary text" } }] });
    expect(
      await generateConversationSummaryOpenrouter({
        apiKey,
        model: "example/text-model",
        userPrompt: "Summarize",
        onUsage,
      }),
    ).toEqual({ summary: "Summary text" });
    fetchStub?.mockRestore();
    answer({ choices: [{ message: { content: "{}" } }] });
    expect(
      await callOpenrouterStructuredJSON(
        { apiKey, model: "example/text-model", systemPrompt: "", userPrompt: "Classify", onUsage },
        {},
        z.object({}),
        "fixture_result",
      ),
    ).toEqual({ success: true, data: {} });
    expect(usageOf(onUsage)).toEqual([
      { inputTokens: 12, outputTokens: 3, costUsd: 0.002 },
      { inputTokens: 12, outputTokens: 3, costUsd: 0.002 },
      { inputTokens: 12, outputTokens: 3, costUsd: 0.002 },
    ]);
  });
});
