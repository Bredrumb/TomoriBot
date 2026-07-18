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

  it("uses generic unknown fallbacks for OpenAI-compatible provider namespaces", () => {
    for (const localeNamespace of ["genai.custom", "genai.deepseek", "genai.zai", "genai.nvidia"]) {
      const description = createOpenAICompatibleErrorDescription(
        {
          type: "api_error",
          message: "Provider returned an unexpected failure",
          code: "599",
          retryable: false,
        },
        "en-US",
        {
          localeNamespace,
          fallbackMessage: "Fallback should not be needed",
        },
      );

      expect(description).toContain("An unexpected error occurred");
      expect(description).not.toContain(`${localeNamespace}.unknown_default_message`);
    }
  });

  it("uses NVIDIA 500 parameter guidance and keeps provider details visible", () => {
    const description = createOpenAICompatibleErrorDescription(
      {
        type: "provider_overloaded",
        message:
          "NVIDIA API error: HTTP 500: ValueError: The min_p and logit_bias sampling parameters are not yet supported with speculative decoding.",
        code: "500",
        retryable: false,
      },
      "en-US",
      {
        localeNamespace: "genai.nvidia",
        fallbackMessage: "Fallback should not be needed",
        appendDetailsForCodes: ["500"],
      },
    );

    expect(description).toContain("NVIDIA rejected one or more request parameters");
    expect(description).toContain("set them to `0` with `/model parameters`");
    expect(description).toContain("`/model logit-bias remove`");
    expect(description).toContain("**Details:**");
    expect(description).toContain("min_p and logit_bias");
  });
});
