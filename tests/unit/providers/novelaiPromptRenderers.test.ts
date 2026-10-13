import { afterEach, describe, expect, it } from "bun:test";
import baseline from "../../fixtures/novelaiPromptBaseline.json";
import { assembleGlmChatPrompt, assembleNovelAIPrompt, buildAttgBlock } from "@/providers/novelai/promptRenderers";
import { NovelaiStreamAdapter } from "@/providers/novelai/novelaiStreamAdapter";
import type { StructuredContextItem } from "@/types/misc/context";
import type { StreamConfig, StreamContext } from "@/types/stream/interfaces";
import { createPersona } from "../../helpers/fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function personaFor(scenario: string, thinkingLevel: string) {
  return createPersona({
    persona_nickname: "Juno",
    nai_attg_author: scenario === "stars-only" ? null : " Mirri ",
    nai_attg_title: scenario === "stars-only" ? null : " A tale ",
    nai_attg_tags: scenario === "stars-only" ? null : " chat, fun ",
    nai_attg_genre: scenario === "stars-only" ? null : " dialogue ",
    nai_attg_stars: 4,
    config: {
      thinking_level: thinkingLevel === "none" ? "none" : "high",
      llm_stop_strings: ["custom-stop"],
      llm_stop_speaker_pattern_enabled: false,
      llm_top_k: 22,
      llm_top_p: 0.82,
      llm_min_p: 0.04,
    },
  });
}

describe("NovelAI renderer extraction", () => {
  it("preserves prompts captured from the original adapter in both prefix and thinking modes", () => {
    for (const entry of baseline.requests) {
      const scenario = baseline.scenarios[entry.scenario as keyof typeof baseline.scenarios];
      const items = scenario.contextItems as StructuredContextItem[];
      const persona = personaFor(entry.scenario, entry.thinkingLevel);
      let prompt: string;
      if (entry.model === "glm-4-6") {
        prompt = assembleGlmChatPrompt(items, "Juno", entry.prefixEnabled, { thinkingLevel: entry.thinkingLevel });
        if (scenario.continuationPrefill) {
          prompt += `${entry.prefixEnabled ? " " : "\n"}${scenario.continuationPrefill.trimStart()}`;
        }
      } else {
        prompt = assembleNovelAIPrompt(items, "Juno", { attgBlock: buildAttgBlock(persona, entry.model) });
        if (!(scenario.outputPrefill && prompt.trimEnd().endsWith(scenario.outputPrefill))) prompt += "\nJuno: ";
      }
      const request = entry.request as { prompt?: string; input?: string };
      const expectedPrompt = request.prompt ?? request.input;
      if (expectedPrompt === undefined) throw new Error("Baseline request has no prompt");
      expect(prompt).toBe(expectedPrompt);
    }
  });

  it("preserves complete wire requests through the adapter, including sampling, stops, and prefills", async () => {
    const prefixEnabled = (process.env.NAI_GLM_CHAR_PREFIX_ENABLED ?? "true").toLowerCase() === "true";
    for (const entry of baseline.requests.filter((entry) => entry.prefixEnabled === prefixEnabled)) {
      const scenario = baseline.scenarios[entry.scenario as keyof typeof baseline.scenarios];
      let request: unknown;
      globalThis.fetch = (async (_input, init) => {
        request = JSON.parse(String(init?.body));
        return new Response("data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
      }) as typeof fetch;
      const context = {
        channel: { id: "channel-1", guildId: "guild-1", isDMBased: () => false },
        client: {},
        tomoriState: personaFor(entry.scenario, entry.thinkingLevel),
        contextItems: scenario.contextItems,
        currentTurnModelParts: [],
        provider: "novelai",
        locale: "en-US",
        outputPrefill: scenario.outputPrefill ?? undefined,
        naiContinuationPrefill: scenario.continuationPrefill ?? undefined,
      } as unknown as StreamContext;
      const adapter = new NovelaiStreamAdapter();
      for await (const chunk of adapter.startStream(
        { model: entry.model, apiKey: "test-key", temperature: 0.73, inactivityTimeoutMs: 5000 } as StreamConfig,
        context,
      ))
        adapter.processChunk(chunk);
      expect(request).toEqual(entry.request);
    }
  });

  it("keeps empty ATTG absent and admits stars only for Erato", () => {
    const persona = createPersona();
    expect(buildAttgBlock(persona, "kayra-v1")).toBeNull();
    expect(buildAttgBlock(persona, "llama-3-erato-v1")).toBeNull();
    for (const stars of [0, 6]) {
      expect(buildAttgBlock({ ...persona, nai_attg_stars: stars }, "llama-3-erato-v1")).toBeNull();
    }
    expect(buildAttgBlock({ ...persona, nai_attg_stars: 3 }, "kayra-v1")).toBeNull();
    expect(buildAttgBlock({ ...persona, nai_attg_stars: 3 }, "llama-3-erato-v1")).toBe("[ S: 3 ]");
  });
});
