import { describe, expect, it } from "bun:test";
import type { ProviderError } from "@/types/stream/interfaces";
import {
  isAccountBalanceExhaustedError,
  isCreditAffordabilityError,
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
