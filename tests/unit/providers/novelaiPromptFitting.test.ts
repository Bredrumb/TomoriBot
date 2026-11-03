import { isOperatorActionableProviderError } from "@/utils/provider/providerErrorClassification";
import { NovelAIPreparationError } from "@/providers/novelai/preparationError";
import { initializeLocalizer } from "@/utils/text/localizer";
import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";
import { fitNovelAIPrompt, prepareNovelAIRequest } from "@/providers/novelai/promptFitting";
import { NovelaiStreamAdapter } from "@/providers/novelai/novelaiStreamAdapter";
import { createNovelAITokenizerEncoder } from "@/utils/provider/localTokenizerRegistry";
import { clearNovelaiSubscriptionCache } from "@/utils/cache/novelaiSubscriptionCache";
import { createLlmRow, createNaiPreset, createPersona } from "../../helpers/fixtures";
import { configRepository } from "@/utils/db/repositories";
import { withSavedProviderConfig } from "@/utils/provider/savedProviderConfig";
import { localizedCopy } from "../../helpers/localeCases";
import { stubGlobalFetch } from "../../helpers/fetchStub";

beforeAll(async () => {
  await initializeLocalizer();
});
const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  clearNovelaiSubscriptionCache();
});

function history(id: string, role: "user" | "model", body: string): StructuredContextItem {
  const text = `${role === "user" ? "Mirri" : "Juno"}: ${body}`;
  return {
    role,
    messageId: id,
    metadataTag: ContextItemTag.DIALOGUE_HISTORY,
    completionText: text,
    parts: [{ type: "text", text }],
    sender: {
      name: role === "user" ? "Mirri" : "Juno",
      type: role === "user" ? "user" : "persona",
    },
  };
}

function fit(
  contextItems: StructuredContextItem[],
  options: {
    model?: string;
    window?: number;
    outputCap?: number;
    triggerMessageId?: string;
  } = {},
) {
  const model = options.model ?? "kayra-v1";
  return fitNovelAIPrompt({
    contextItems,
    tomoriState: createPersona({ persona_nickname: "Juno", config: { thinking_level: "none" } }),
    profile: getNovelAIProfile(model),
    window: options.window ?? 4096,
    maxOutputTokens: options.outputCap ?? 256,
    triggerMessageId: options.triggerMessageId,
  });
}

describe("NovelAI prompt fitting", () => {
  it("renders persistent content without a system block except for Xialong's provider prompt", () => {
    const state = createPersona({
      persona_nickname: "Juno",
      nai_attg_tags: "forest",
      nai_attg_genre: "fantasy",
      config: { thinking_level: "none" },
    });
    const contextItems: StructuredContextItem[] = [
      {
        role: "system",
        metadataTag: ContextItemTag.SYSTEM_PERSONALITY,
        parts: [{ type: "text", text: "personality-marker" }],
      },
      {
        role: "system",
        metadataTag: ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
        parts: [{ type: "text", text: "memory-marker" }],
      },
      history("trigger", "user", "Hello."),
    ];
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      const profile = getNovelAIProfile(model);
      const { prompt } = fitNovelAIPrompt({ contextItems, tomoriState: state, profile, window: 4096 });
      expect(prompt).toContain("personality-marker");
      expect(prompt).toMatch(/memory-marker/iu);
      if (profile.renderer === "xialong") {
        expect(prompt).toStartWith(
          `[gMASK]<sop>\n<|system|>\n${profile.systemPrompt}\n<|user|>\nRelevant persistent information:\n[ Tags: forest; Genre: fantasy ][ S: 4 ]\n`,
        );
        expect(prompt.search(/memory-marker/iu)).toBeGreaterThan(prompt.indexOf("[ S: 4 ]"));
        expect(prompt).toEndWith("<|assistant|>\n<think></think>");
      } else {
        expect(prompt).not.toContain("<|system|>");
        if (profile.renderer === "glm") {
          expect(prompt.indexOf("personality-marker")).toBeGreaterThan(prompt.indexOf("<|user|>"));
        }
      }
    }
  });

  it("fits a long channel into 4096 tokens, reports removals, and preserves whole protected exchanges", () => {
    const items = Array.from({ length: 14 }, (_, index) => [
      history(`user-${index}`, "user", `question-${index}${" river".repeat(220)}`),
      history(`model-${index}`, "model", `answer-${index}${" forest".repeat(220)}`),
    ]).flat();
    const prepared = fit(items, { triggerMessageId: "user-0" });
    const report = prepared.report;
    expect(report.inputTokens + report.outputCap + report.framingReserve + report.sentenceReserve).toBeLessThanOrEqual(
      4096,
    );
    expect(report.inputTokens).toBe(createNovelAITokenizerEncoder("novelai_nerdstash_v2")(prepared.prompt).length);
    expect(report.trimmed.length).toBeGreaterThan(0);
    expect(report.excluded).toEqual([]);
    for (const index of [0, 12, 13]) {
      expect(prepared.contextItems.some((item) => item.messageId === `user-${index}`)).toBe(true);
      expect(prepared.contextItems.some((item) => item.messageId === `model-${index}`)).toBe(true);
    }
    for (let index = 0; index < 14; index++) {
      expect(prepared.contextItems.some((item) => item.messageId === `user-${index}`)).toBe(
        prepared.contextItems.some((item) => item.messageId === `model-${index}`),
      );
    }
  });

  it("drops extra examples before memories and old history, retaining the minimum example exchange", () => {
    const samples: StructuredContextItem[] = Array.from({ length: 3 }, (_, index) => [
      {
        role: "user" as const,
        metadataTag: ContextItemTag.DIALOGUE_SAMPLE,
        parts: [{ type: "text" as const, text: `sample-${index}${" river".repeat(200)}` }],
      },
      {
        role: "model" as const,
        metadataTag: ContextItemTag.DIALOGUE_SAMPLE,
        parts: [{ type: "text" as const, text: `Juno: sample-${index}${" forest".repeat(200)}` }],
      },
    ]).flat();
    const memories: StructuredContextItem = {
      role: "system",
      metadataTag: ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
      parts: [],
      memoryEntries: Array.from({ length: 5 }, (_, index) => ({
        id: `memory-${index}`,
        text: `memory-${index}${" river".repeat(100)}`,
      })),
    };
    const prepared = fit([
      ...samples,
      memories,
      ...Array.from({ length: 10 }, (_, index) => [
        history(`u-${index}`, "user", " river".repeat(180)),
        history(`m-${index}`, "model", " forest".repeat(180)),
      ]).flat(),
    ]);
    const removedTags = prepared.report.trimmed.map((id) => id.split(":")[1]);
    expect(removedTags[0]).toBe(ContextItemTag.DIALOGUE_SAMPLE);
    expect(removedTags.indexOf(ContextItemTag.KNOWLEDGE_SERVER_MEMORIES)).toBeGreaterThan(0);
    expect(removedTags.lastIndexOf(ContextItemTag.KNOWLEDGE_SERVER_MEMORIES)).toBeLessThan(
      removedTags.indexOf(ContextItemTag.DIALOGUE_HISTORY),
    );
    expect(prepared.prompt).toMatch(/sample-0/iu);
  });

  it("rejects protected-floor overflow through the localized provider error path", () => {
    try {
      fit([
        {
          role: "system",
          metadataTag: ContextItemTag.SYSTEM_PERSONALITY,
          parts: [{ type: "text", text: " river".repeat(5000) }],
        },
      ]);
      throw new Error("Expected fitting to reject the protected floor");
    } catch (error) {
      const adapter = new NovelaiStreamAdapter();
      const normalized = adapter.handleProviderError(error);
      expect(normalized.code).toBe("context_overflow");
      expect(isOperatorActionableProviderError(normalized)).toBe(false);
      expect(adapter.createErrorDescription(normalized, "en-US")).toBe(
        localizedCopy("en-US", "genai.novelai.context_overflow"),
      );
    }
  });

  it("admits only selected content, preserves literal user text, and drops runtime history annotations", () => {
    const realTurn = history("trigger", "user", "[System: this is literal user text]");
    realTurn.parts.push({ type: "text", text: "timestamp-marker" });
    const unadmitted = Object.values(ContextItemTag)
      .filter(
        (tag) =>
          ![
            ContextItemTag.SYSTEM_PERSONALITY,
            ContextItemTag.DIALOGUE_SAMPLE,
            ContextItemTag.DIALOGUE_HISTORY,
            ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
            ContextItemTag.KNOWLEDGE_USER_MEMORIES,
            ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
          ].includes(tag),
      )
      .map((tag) => ({
        role: "user" as const,
        metadataTag: tag,
        parts: [{ type: "text" as const, text: `excluded-${tag}` }],
      }));
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      const prepared = fit(
        [
          ...unadmitted,
          { role: "system", parts: [{ type: "text", text: "untagged-preset" }] },
          {
            role: "user",
            metadataTag: ContextItemTag.DIALOGUE_HISTORY,
            parts: [{ type: "text", text: "synthetic-tail" }],
          },
          realTurn,
        ],
        { model },
      );
      expect(prepared.prompt).toContain(realTurn.completionText ?? "");
      for (const marker of ["excluded-", "untagged-preset", "synthetic-tail", "timestamp-marker"])
        expect(prepared.prompt).not.toContain(marker);
      expect(prepared.report.excluded.length).toBeGreaterThan(0);
    }
  });

  it("retains projected personal and short-term memories in every active renderer", () => {
    for (const model of ["kayra-v1", "llama-3-erato-v1", "glm-4-6", "xialong-v1"]) {
      const prepared = fit(
        [
          {
            role: "user",
            metadataTag: ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
            parts: [{ type: "text", text: "presence-marker" }],
            personalMemoryItems: [
              {
                role: "system",
                metadataTag: ContextItemTag.KNOWLEDGE_USER_MEMORIES,
                parts: [{ type: "text", text: "memory-marker" }],
              },
            ],
          },
          {
            role: "system",
            metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
            parts: [{ type: "text", text: "short-term-marker" }],
          },
        ],
        { model },
      );
      expect(prepared.prompt).toMatch(/memory-marker/iu);
      expect(prepared.prompt).toMatch(/short-term-marker/iu);
      expect(prepared.prompt).not.toContain("presence-marker");
    }
  });

  it("trims individual personal memories by recency while retaining their owner and source identities", () => {
    const prepared = fit([
      {
        role: "user",
        metadataTag: ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
        parts: [],
        personalMemoryItems: [
          {
            role: "system",
            metadataTag: ContextItemTag.KNOWLEDGE_USER_MEMORIES,
            parts: [],
            memoryEntries: [1, 2, 3].map((id) => ({
              id: `personal:${id}`,
              createdAt: id,
              text: `Mirri: memory-${id}${" river".repeat(300)}`,
            })),
          },
        ],
      },
    ]);
    expect(prepared.report.trimmed.some((id) => id.endsWith("personal:1"))).toBe(true);
    expect(prepared.report.included.some((id) => id.endsWith("personal:2"))).toBe(true);
    expect(prepared.report.included.some((id) => id.endsWith("personal:3"))).toBe(true);
    expect(prepared.prompt).not.toContain("memory-1");
    expect(prepared.prompt).toContain("Mirri: memory-2");
  });

  it("makes the configured output budget win over preset length for each active model", () => {
    for (const model of ["kayra-v1", "llama-3-erato-v1", "glm-4-6", "xialong-v1"]) {
      const state = createPersona({
        config: { llm_max_output_tokens: 512, llm_disabled_params: ["temperature", "topK"] },
      });
      const target = getNovelAIProfile(model).samplingPresetTarget;
      if (target)
        state.nai_preset = createNaiPreset({
          model_target: target,
          parameters: { max_length: 17, temperature: 1.45, top_k: 23 },
        });
      const prepared = fitNovelAIPrompt({
        tomoriState: state,
        profile: getNovelAIProfile(model),
        window: 4096,
        contextItems: [],
      });
      expect(prepared.parameters.max_length).toBe(512);
      expect(prepared.parameters.temperature).toBeUndefined();
      expect(prepared.parameters.top_k).toBeUndefined();
    }
  });

  it("uses each model's own defaults for incompatible presets and same-provider fallbacks", () => {
    for (const model of ["kayra-v1", "llama-3-erato-v1", "glm-4-6", "xialong-v1"]) {
      const profile = getNovelAIProfile(model);
      const wrong = createNaiPreset({ model_target: model === "kayra-v1" ? "erato" : "kayra" });
      for (const kind of ["preset", "fallback"] as const) {
        const preset = kind === "preset" ? wrong : undefined;
        const state = createPersona({
          llm: createLlmRow({ llm_provider: "novelai", llm_codename: model, llm_id: kind === "fallback" ? 2 : 1 }),
          nai_preset: preset,
          config: {
            nai_preset_name: preset?.preset_name ?? null,
            llm_temperature: 0.25,
            llm_top_k: 1,
            llm_top_p: 0.1,
            llm_min_p: 0.9,
            llm_max_output_tokens: 512,
          },
        });
        const before = JSON.stringify(state);
        const prepared = fitNovelAIPrompt({ tomoriState: state, profile, contextItems: [], window: 4096 });
        for (const key of [
          "temperature",
          "top_k",
          "top_p",
          "min_p",
          "phrase_rep_pen",
          "repetition_penalty",
          "order",
        ] as const) {
          expect(prepared.parameters[key]).toEqual(profile.parameters()[key]);
        }
        expect(prepared.parameters.max_length).toBe(512);
        expect(JSON.stringify(state)).toBe(before);
      }
    }
  });

  it("loads a personal or saved preset by its own scope and preserves later sampler edits", async () => {
    const preset = createNaiPreset({
      preset_name: "Asper-Kayra",
      is_default: false,
      parameters: { phrase_rep_pen: "light", repetition_penalty: 1.68 },
    });
    const load = spyOn(configRepository, "resolveNaiPreset").mockResolvedValue(preset);
    restores.push(() => load.mockRestore());
    const fetch = stubGlobalFetch(() => Response.json({ tier: 1, active: true }));
    restores.push(() => fetch.mockRestore());
    const base = createPersona({
      nai_preset: createNaiPreset({ model_target: "erato" }),
      llm: createLlmRow({ llm_provider: "novelai", llm_codename: "kayra-v1" }),
    });
    const state = withSavedProviderConfig(base, {
      provider: "novelai",
      api_key: null,
      llm_id: 1,
      nai_preset_name: preset.preset_name,
      llm_temperature: 1.22,
      llm_top_k: 33,
    });
    const prepared = await prepareNovelAIRequest({
      tomoriState: state,
      model: "kayra-v1",
      apiKey: "test-preset",
      contextItems: [],
      maxOutputTokens: 512,
    });
    expect(load).toHaveBeenCalledWith("kayra-v1", "Asper-Kayra");
    expect(prepared.parameters).toMatchObject({
      temperature: 1.22,
      top_k: 33,
      phrase_rep_pen: "light",
      repetition_penalty: 1.68,
      max_length: 512,
    });
    expect(state.nai_preset).toBeUndefined();
    expect(base.nai_preset?.model_target).toBe("erato");
  });

  it("honors larger configured completion budgets and the native API schema ceiling", () => {
    for (const { model, configured, expected } of [
      { model: "glm-4-6", configured: 8192, expected: 8192 },
      { model: "kayra-v1", configured: 4096, expected: 2048 },
    ]) {
      const prepared = fitNovelAIPrompt({
        tomoriState: createPersona({ config: { llm_max_output_tokens: configured } }),
        profile: getNovelAIProfile(model),
        window: 28672,
        contextItems: [],
      });
      expect(prepared.report.outputCap).toBe(expected);
      expect(prepared.parameters.max_length).toBe(expected);
    }
  });

  it("keeps expected preparation refusals out of the incident feed while reporting missing host assets", () => {
    const adapter = new NovelaiStreamAdapter();
    for (const code of [
      "input_complexity",
      "context_overflow",
      "subscription_unavailable",
      "subscription_inactive",
      "model_tier",
      "continuation_exhausted",
    ] as const) {
      expect(isOperatorActionableProviderError(adapter.handleProviderError(new NovelAIPreparationError(code)))).toBe(
        false,
      );
    }
    expect(
      isOperatorActionableProviderError(adapter.handleProviderError(new NovelAIPreparationError("tokenizer_setup"))),
    ).toBe(true);
  });

  it("rejects unknown models and credentials whose subscription cannot supply a known active allowance", async () => {
    expect(() => getNovelAIProfile("unknown-novelai-model")).toThrow();
    for (const [payload, code] of [
      [{}, "subscription_unavailable"],
      [{ tier: 3, active: false }, "subscription_inactive"],
      [{ tier: 99, active: true }, "model_tier"],
    ] as const) {
      const fetch = stubGlobalFetch(() => Response.json(payload));
      restores.push(() => fetch.mockRestore());
      await expect(
        prepareNovelAIRequest({
          tomoriState: createPersona({ llm: createLlmRow({ llm_provider: "novelai" }) }),
          model: "kayra-v1",
          apiKey: `key-${code}`,
          contextItems: [],
        }),
      ).rejects.toMatchObject({ code });
      fetch.mockRestore();
    }
  });

  it("checks renewed subscriptions on the next request instead of retaining an inactive allowance", async () => {
    let active = false;
    const fetch = stubGlobalFetch(() => Response.json({ tier: 1, active }));
    restores.push(() => fetch.mockRestore());
    const args = { tomoriState: createPersona(), model: "kayra-v1", apiKey: "renewed-key", contextItems: [] };
    await expect(prepareNovelAIRequest(args)).rejects.toMatchObject({ code: "subscription_inactive" });
    active = true;
    expect((await prepareNovelAIRequest(args)).report.window).toBe(4096);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("trims past replies matching the current prefill while protecting the actual tail prefill", () => {
    const body = "forest ".repeat(100).trimEnd();
    const outputPrefill = `Juno: ${body}`;
    const items = Array.from({ length: 8 }, (_, index) => [
      history(`user-${index}`, "user", " river".repeat(200)),
      history(`model-${index}`, "model", body),
    ]).flat();
    const prepared = fitNovelAIPrompt({
      tomoriState: createPersona({ persona_nickname: "Juno" }),
      profile: getNovelAIProfile("kayra-v1"),
      window: 1024,
      maxOutputTokens: 128,
      outputPrefill,
      contextItems: [
        ...items,
        {
          role: "model",
          metadataTag: ContextItemTag.DIALOGUE_HISTORY,
          completionText: outputPrefill,
          parts: [{ type: "text", text: outputPrefill }],
        },
      ],
    });
    expect(prepared.contextItems.some((item) => item.messageId === "model-0")).toBe(false);
    expect(prepared.contextItems.at(-1)?.completionText).toBe(outputPrefill);
    expect(prepared.prompt).toEndWith(outputPrefill);
    expect(
      prepared.report.inputTokens +
        prepared.report.outputCap +
        prepared.report.framingReserve +
        prepared.report.sentenceReserve,
    ).toBeLessThanOrEqual(1024);
  });

  it("preserves explicit speaker and sprite prefills as the actual generation tail for every profile", () => {
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      for (const outputPrefill of ["Juno: opening-fragment", "Juno (happy): opening-fragment"]) {
        const prepared = fitNovelAIPrompt({
          tomoriState: createPersona({ persona_nickname: "Juno" }),
          profile: getNovelAIProfile(model),
          window: 4096,
          outputPrefill,
          contextItems: [
            history("trigger", "user", "hello"),
            {
              role: "model",
              metadataTag: ContextItemTag.DIALOGUE_HISTORY,
              completionText: outputPrefill,
              parts: [{ type: "text", text: outputPrefill }],
            },
          ],
        });
        expect(prepared.prompt).toEndWith(outputPrefill);
        expect(prepared.prompt).not.toContain("Juno: Juno");
      }
    }
  });
});
