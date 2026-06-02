import { describe, expect, it } from "bun:test";
import {
  buildModelParametersSamplerPatch,
  type ModelParameterOptions,
  type ModelParameterSavedConfigSnapshot,
} from "@/utils/discord/modelParametersConfigMapping";

const ALL_NULL_OPTIONS: ModelParameterOptions = {
  temperature: null,
  top_p: null,
  top_k: null,
  frequency_penalty: null,
  presence_penalty: null,
  min_p: null,
  max_output_tokens: null,
  thinking_level: null,
};

const BASE_SAVED_CONFIG: ModelParameterSavedConfigSnapshot = {
  llm_temperature: 1.0,
  llm_top_p: 0.95,
  llm_top_k: 40,
  llm_frequency_penalty: 0.1,
  llm_presence_penalty: 0.2,
  llm_min_p: 0.05,
  llm_max_output_tokens: 1024,
  thinking_level: "auto",
};

describe("/model parameters write plan", () => {
  it("routes all provided options to the correct patch field names", () => {
    const patch = buildModelParametersSamplerPatch(
      {
        temperature: 0.7,
        top_p: 0.9,
        top_k: 20,
        frequency_penalty: 0.3,
        presence_penalty: 0.4,
        min_p: 0.02,
        max_output_tokens: 2048,
        thinking_level: "high",
      },
      BASE_SAVED_CONFIG,
    );

    expect(patch.llm_temperature).toBe(0.7);
    expect(patch.llm_top_p).toBe(0.9);
    expect(patch.llm_top_k).toBe(20);
    expect(patch.llm_frequency_penalty).toBe(0.3);
    expect(patch.llm_presence_penalty).toBe(0.4);
    expect(patch.llm_min_p).toBe(0.02);
    expect(patch.llm_max_output_tokens).toBe(2048);
    expect(patch.thinking_level).toBe("high");
  });

  it("preserves all saved config values when no options are provided", () => {
    const patch = buildModelParametersSamplerPatch(ALL_NULL_OPTIONS, BASE_SAVED_CONFIG);

    expect(patch.llm_temperature).toBe(1.0);
    expect(patch.llm_top_p).toBe(0.95);
    expect(patch.llm_top_k).toBe(40);
    expect(patch.llm_frequency_penalty).toBe(0.1);
    expect(patch.llm_presence_penalty).toBe(0.2);
    expect(patch.llm_min_p).toBe(0.05);
    expect(patch.llm_max_output_tokens).toBe(1024);
    expect(patch.thinking_level).toBe("auto");
  });

  it("a single provided option does not disturb the other saved fields", () => {
    const patch = buildModelParametersSamplerPatch({ ...ALL_NULL_OPTIONS, temperature: 0.5 }, BASE_SAVED_CONFIG);

    expect(patch.llm_temperature).toBe(0.5);
    expect(patch.llm_top_p).toBe(0.95);
    expect(patch.llm_top_k).toBe(40);
    expect(patch.llm_frequency_penalty).toBe(0.1);
    expect(patch.llm_presence_penalty).toBe(0.2);
    expect(patch.llm_min_p).toBe(0.05);
    expect(patch.llm_max_output_tokens).toBe(1024);
    expect(patch.thinking_level).toBe("auto");
  });

  it("max_output_tokens falls to null when both option and saved config are absent", () => {
    const patch = buildModelParametersSamplerPatch(ALL_NULL_OPTIONS, {
      ...BASE_SAVED_CONFIG,
      llm_max_output_tokens: undefined,
    });

    expect(patch.llm_max_output_tokens).toBeNull();
  });

  it("provided max_output_tokens takes precedence over saved config value", () => {
    const patch = buildModelParametersSamplerPatch(
      { ...ALL_NULL_OPTIONS, max_output_tokens: 512 },
      { ...BASE_SAVED_CONFIG, llm_max_output_tokens: 9999 },
    );

    expect(patch.llm_max_output_tokens).toBe(512);
  });

  it("patch does not carry non-sampler provider fields", () => {
    const patch = buildModelParametersSamplerPatch(ALL_NULL_OPTIONS, BASE_SAVED_CONFIG);

    expect("api_key" in patch).toBe(false);
    expect("provider" in patch).toBe(false);
    expect("llm_id" in patch).toBe(false);
    expect("server_id" in patch).toBe(false);
    expect("nai_preset_name" in patch).toBe(false);
    expect("diffusion_model_id" in patch).toBe(false);
  });

  it("accepts all valid thinking_level choices without narrowing error", () => {
    for (const level of ["auto", "none", "low", "medium", "high"] as const) {
      const patch = buildModelParametersSamplerPatch({ ...ALL_NULL_OPTIONS, thinking_level: level }, BASE_SAVED_CONFIG);
      expect(patch.thinking_level).toBe(level);
    }
  });
});
