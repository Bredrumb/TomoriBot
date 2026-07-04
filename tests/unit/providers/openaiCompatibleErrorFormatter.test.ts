import { beforeAll, describe, expect, it } from "bun:test";
import {
  createOpenAICompatibleErrorDescription,
  createOpenAICompatibleHttpError,
  normalizeOpenAICompatibleProviderError,
} from "@/providers/openaiCompatible/openaiCompatibleErrorFormatter";
import { initializeLocalizer } from "@/utils/text/localizer";

describe("openAI-compatible provider error formatting", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("extracts FastAPI detail text from HTTP errors", () => {
    const error = createOpenAICompatibleHttpError(
      400,
      "Bad Request",
      '{"detail":"Unsupported model `Deepseek` for provider `DeepSeek`. Supported IDs: `deepseek-auto`."}',
    );

    expect(error.message).toBe(
      "HTTP 400: Unsupported model `Deepseek` for provider `DeepSeek`. Supported IDs: `deepseek-auto`.",
    );
  });

  it("classifies unsupported-model errors as non-retryable model errors with details", () => {
    const rawError = new Error(
      "HTTP 400: Unsupported model `Deepseek` for provider `DeepSeek`. Supported IDs: `deepseek-auto`.",
    );
    const providerError = normalizeOpenAICompatibleProviderError(rawError, {
      errorMessagePrefix: "Custom endpoint error",
    });

    expect(providerError.type).toBe("model_error");
    expect(providerError.code).toBe("400_model");
    expect(providerError.retryable).toBe(false);

    const description = createOpenAICompatibleErrorDescription(providerError, "en-US", {
      localeNamespace: "genai.custom",
      fallbackMessage: "Custom endpoint failed.",
    });

    expect(description).toContain("The selected model was rejected by the provider");
    expect(description).toContain("Unsupported model `Deepseek`");
    expect(description).toContain("Supported IDs: `deepseek-auto`");
  });
});
