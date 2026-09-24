import { describe, expect, it } from "bun:test";
import type { ProviderError } from "@/types/stream/interfaces";
import {
  createOpenAICompatibleHttpError,
  normalizeOpenAICompatibleProviderError,
} from "@/providers/openaiCompatible/openaiCompatibleErrorFormatter";
import {
  isAccountBalanceExhaustedError,
  isCreditAffordabilityError,
  isNvidiaCredentialRejected,
  isProviderModelError,
} from "@/utils/provider/providerErrorClassification";

function providerError(message: string, code = "402"): ProviderError {
  return {
    type: "api_error",
    message,
    code,
    retryable: false,
    originalError: new Error(message),
  };
}

describe("account balance exhaustion classification", () => {
  it("classifies a DeepSeek 402 as exhausted balance, not an affordability ceiling", () => {
    const error = providerError("Deepseek Stream Error: HTTP 402: Insufficient Balance");

    expect(isAccountBalanceExhaustedError(error)).toBe(true);
    // Overlap here would hand the user a `reduce_output_tokens` tip that cannot work on a zero balance.
    expect(isCreditAffordabilityError(error)).toBe(false);
  });

  it("keeps an OpenRouter affordability ceiling out of the exhausted-balance branch", () => {
    const error = providerError(
      "OpenRouter: HTTP 402: This request requires more credits, or fewer max_tokens. You requested up to 16384 tokens, but can only afford 7783.",
    );

    expect(isCreditAffordabilityError(error)).toBe(true);
    expect(isAccountBalanceExhaustedError(error)).toBe(false);
  });

  it("classifies the Z.ai billing denial that arrives as a 429", () => {
    const error = providerError("Z.ai Stream Error: HTTP 429: no resource package. Please recharge.", "429_balance");

    expect(isAccountBalanceExhaustedError(error)).toBe(true);
  });

  it("leaves a genuine rate limit unclassified", () => {
    const error = providerError("HTTP 429: rate limit exceeded, please slow down", "429");

    expect(isAccountBalanceExhaustedError(error)).toBe(false);
    expect(isCreditAffordabilityError(error)).toBe(false);
  });

  it("reads the balance signal out of the original error payload", () => {
    const error: ProviderError = {
      type: "api_error",
      message: "Provider request failed",
      code: "402",
      retryable: false,
      originalError: { error: { message: "Insufficient Balance" } },
    };

    expect(isAccountBalanceExhaustedError(error)).toBe(true);
  });
});

/** Runs a NIM HTTP failure through the same normalizer the stream path uses, so the tests pin the real shape. */
function nimError(status: number, statusText: string, body: string): ProviderError {
  return normalizeOpenAICompatibleProviderError(createOpenAICompatibleHttpError(status, statusText, body), {
    errorMessagePrefix: "NVIDIA API error",
  });
}

describe("NVIDIA credential rejection classification", () => {
  const authorizationFailed = '{"status":403,"title":"Forbidden","detail":"Authorization failed"}';

  it("classifies the 403 NIM returns for a mistyped or expired key", () => {
    expect(isNvidiaCredentialRejected("nvidia", nimError(403, "Forbidden", authorizationFailed))).toBe(true);
  });

  it("does not attach expiry advice to another provider's 403", () => {
    expect(isNvidiaCredentialRejected("anthropic", nimError(403, "Forbidden", authorizationFailed))).toBe(false);
  });

  it("leaves a key without the nvapi- prefix to the plain key check", () => {
    // NIM answers a malformed key with 401 rather than 403; expiry cannot explain that one.
    const error = nimError(401, "Unauthorized", '{"detail":"Authentication failed"}');

    expect(isNvidiaCredentialRejected("nvidia", error)).toBe(false);
  });
});

describe("NVIDIA model availability classification", () => {
  it("treats a retired model's 410 as a model error", () => {
    const error = nimError(
      410,
      "Gone",
      `{"status":410,"title":"Gone","detail":"The model 'z-ai/glm-5.2' has reached its end of life on 2026-08-21T09:00:00Z and is no longer available."}`,
    );

    expect(error.type).toBe("model_error");
    expect(isProviderModelError(error)).toBe(true);
  });

  it("treats a model the account cannot reach as a model error", () => {
    const error = nimError(
      404,
      "Not Found",
      `{"status":404,"title":"Not Found","detail":"Function '23d4f03a-b8a6-4adb-a183-7daa083a09cc': Not found for account 'abc'"}`,
    );

    expect(error.type).toBe("model_error");
  });

  it("leaves NIM's bare 404 for a retired route as an api_error", () => {
    expect(nimError(404, "Not Found", "404 page not found").type).toBe("api_error");
  });
});
