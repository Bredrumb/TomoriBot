import { describe, expect, test } from "bun:test";
import { resolveChatCompletionsUrl, resolveVisionApiModelName } from "@/utils/provider/visionCaption";

/**
 * The shared vision module is the only place a provider's image transport is chosen, so a
 * provider that supports vision but has no transport here fails at request time rather than
 * at review time. These tests pin both the resolution rules and the coverage gap.
 */
describe("vision api model name resolution", () => {
  test("translates zai codenames to the backend model string", () => {
    expect(resolveVisionApiModelName("zai", "zai/glm-4.6v", "ignored-by-zai")).toBe("glm-4.6v");
    expect(resolveVisionApiModelName("zaicoding", "glm-4.6v", "ignored-by-zai")).toBe("glm-4.6v");
  });

  test("prefers the endpoint's own model name for a custom provider", () => {
    expect(resolveVisionApiModelName("custom:s17:koboldcpp", "local-codename", "upstream-model")).toBe(
      "upstream-model",
    );
  });

  test("falls back to the codename when the endpoint names no model", () => {
    // Backends such as KoboldCpp ignore the field entirely and answer for whatever is loaded.
    expect(resolveVisionApiModelName("custom:s17:koboldcpp", "local-codename", null)).toBe("local-codename");
    expect(resolveVisionApiModelName("custom:s17:koboldcpp", "local-codename", "   ")).toBe("local-codename");
  });

  test("passes a normal provider's codename through untouched", () => {
    expect(resolveVisionApiModelName("google", "gemini-3.5-flash-lite")).toBe("gemini-3.5-flash-lite");
    expect(resolveVisionApiModelName("openrouter", "google/gemma-4-31b-it")).toBe("google/gemma-4-31b-it");
    expect(resolveVisionApiModelName("anthropic", "claude-vision-test")).toBe("claude-vision-test");
  });
});

describe("vision chat-completions transport coverage", () => {
  test("resolves a dedicated endpoint for every OpenAI-compatible provider", () => {
    for (const provider of ["openrouter", "zai", "zaicoding", "deepseek", "nvidia"]) {
      const url = resolveChatCompletionsUrl(provider);
      expect(url).toStartWith("https://");
      expect(url).toEndWith("/chat/completions");
    }
  });

  test("never falls back to an OpenAI URL for a foreign provider", () => {
    // The previous tool-level map had no nvidia entry and fell through to an OpenAI default,
    // which would have sent a foreign bearer key to the wrong host.
    expect(resolveChatCompletionsUrl("nvidia")).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(resolveChatCompletionsUrl("nonexistent-provider")).toBeNull();
  });

  test("builds a custom endpoint URL without doubling the path", () => {
    // The stored name keeps its connection id: canonicalizing to `custom` first would lose the
    // connection the endpoint URL is looked up from, and no transport would be found at all.
    expect(resolveChatCompletionsUrl("custom:17", "http://127.0.0.1:5001/v1")).toBe(
      "http://127.0.0.1:5001/v1/chat/completions",
    );
    expect(resolveChatCompletionsUrl("custom:17", "http://127.0.0.1:5001/v1/chat/completions")).toBe(
      "http://127.0.0.1:5001/v1/chat/completions",
    );
    expect(resolveChatCompletionsUrl("custom:17", "http://127.0.0.1:5001/v1/")).toBe(
      "http://127.0.0.1:5001/v1/chat/completions",
    );
    expect(resolveChatCompletionsUrl("custom:17", "   ")).toBeNull();
    // The canonical name alone has no connection to resolve an endpoint from.
    expect(resolveChatCompletionsUrl("custom", "http://127.0.0.1:5001/v1")).toBeNull();
  });
});
