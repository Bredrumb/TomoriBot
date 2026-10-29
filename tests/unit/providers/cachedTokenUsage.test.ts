import { describe, expect, it } from "bun:test";
import { GoogleGenAI } from "@google/genai";
import { AnthropicStreamAdapter } from "@/providers/anthropic/anthropicStreamAdapter";
import { GoogleStreamAdapter } from "@/providers/google/googleStreamAdapter";
import { VertexStreamAdapter } from "@/providers/vertex/vertexStreamAdapter";
import { VertexexpressStreamAdapter } from "@/providers/vertexexpress/vertexexpressStreamAdapter";
import { OpenAICompatibleStreamAdapter } from "@/providers/openaiCompatible/openaiCompatibleStreamAdapter";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { HumanizerDegree } from "@/types/db/schema";
import type { StreamConfig, StreamContext, StreamProvider } from "@/types/stream/interfaces";
import type { StreamResult } from "@/types/provider/interfaces";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import {
  createProviderUsageRecorder,
  registerProviderUsageReporter,
  type ProviderUsageReport,
} from "@/utils/provider/providerUsage";
import { sumTurnUsage } from "@/utils/text/tokenEstimate";
import fixtures from "../../fixtures/cachedTokenUsage.json";
import { createPersona } from "../../helpers/fixtures";
import { stubGlobalFetch } from "../../helpers/fetchStub";

const config: StreamConfig = {
  model: "fixture-model",
  apiKey: "fixture-key",
  temperature: 0.8,
  inactivityTimeoutMs: 5000,
  maxMessageLength: 2000,
  flushBufferSize: 1000,
  flushBufferSizeCodeBlock: 15000,
  baseTypeSpeedMsPerChar: 0,
  maxTypingTimeMs: 0,
  minVisibleTypingDurationMs: 0,
  humanizerDegree: HumanizerDegree.NONE,
  emojiUsageEnabled: true,
};

function makeContext(provider: string): StreamContext {
  return {
    channel: { id: "cache_usage_fixture", isThread: () => false },
    client: {},
    tomoriState: createPersona({ config: { thinking_level: "none", llm_stop_speaker_pattern_enabled: false } }),
    contextItems: [{ role: "user", parts: [{ type: "text", text: "Hello" }] }],
    currentTurnModelParts: [],
    provider,
    locale: "en-US",
    holdResponseText: true,
  } as unknown as StreamContext;
}

describe("provider cache usage through stream accounting", () => {
  const cases: Array<{ provider: string; fixture: keyof typeof fixtures; adapter: () => StreamProvider }> = [
    { provider: "anthropic", fixture: "anthropic", adapter: () => new AnthropicStreamAdapter() },
    { provider: "google", fixture: "gemini", adapter: () => new GoogleStreamAdapter() },
    {
      provider: "vertex",
      fixture: "gemini",
      adapter: () => new VertexStreamAdapter({ clientFactory: (apiKey) => new GoogleGenAI({ apiKey }) }),
    },
    { provider: "vertexexpress", fixture: "gemini", adapter: () => new VertexexpressStreamAdapter() },
    { provider: "openrouter", fixture: "openrouter", adapter: () => new OpenrouterStreamAdapter() },
    {
      provider: "openai",
      fixture: "openai",
      adapter: () =>
        new OpenAICompatibleStreamAdapter({
          providerName: "openai",
          adapterName: "Fixture",
          localeNamespace: "fixture",
          errorMessagePrefix: "Fixture",
          resolveApiUrl: () => "https://example.test/v1/chat/completions",
        }),
    },
  ];

  for (const entry of cases) {
    it(`preserves ${entry.provider} cache counts across two requests and provider reporting`, async () => {
      const fixture = fixtures[entry.fixture];
      const reports: ProviderUsageReport[] = [];
      const restoreReporter = registerProviderUsageReporter((_context, report) => {
        reports.push(report);
      });
      const recorder = createProviderUsageRecorder({}, config.model);
      const results: StreamResult[] = [];
      try {
        const adapter = entry.adapter();
        for (const events of fixture.segments) {
          const body = events
            .map(
              (event) =>
                `${entry.fixture === "anthropic" && "type" in event ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`,
            )
            .join("");
          const fetchStub = stubGlobalFetch(
            () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
          );
          try {
            const result = await new StreamOrchestrator().streamToDiscord(adapter, config, makeContext(entry.provider));
            expect(result).toMatchObject({ status: "completed" });
            expect(result.usage).toBeDefined();
            if (result.usage) recorder?.(result.usage);
            results.push(result);
          } finally {
            fetchStub.mockRestore();
          }
        }
        expect(sumTurnUsage(results)).toEqual(fixture.expected);
        expect(reports).toEqual(
          results.map((result) => ({ modelCodename: config.model, ...result.usage, costUsd: result.usage?.costUsd })),
        );
        expect(results[1]?.usage?.cacheReadTokens).toBe(entry.fixture === "anthropic" ? 750 : 0);
        expect(reports.map((report) => report.modelCodename)).toEqual([config.model, config.model]);
      } finally {
        restoreReporter();
      }
    });
  }
});
