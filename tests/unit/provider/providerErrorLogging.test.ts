import { beforeEach, describe, expect, it } from "bun:test";
import { stubLogMembers } from "../../helpers/mockSurface";

const errorCalls: string[] = [];
const warnCalls: string[] = [];

stubLogMembers({
  error: async (msg: string) => {
    errorCalls.push(msg);
  },
  warn: (msg: string) => {
    warnCalls.push(msg);
  },
});

const { logRawProviderError } = await import("@/utils/provider/providerErrorLogging");

describe("provider error log severity", () => {
  beforeEach(() => {
    errorCalls.length = 0;
    warnCalls.length = 0;
  });

  it("keeps an exhausted balance out of the error dashboard", () => {
    logRawProviderError("DeepseekStreamAdapter", new Error("HTTP 402: Insufficient Balance"));

    expect(errorCalls).toHaveLength(0);
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain("DeepseekStreamAdapter");
    expect(warnCalls[0]).toContain("balance exhausted");
  });

  it("finds the balance signal inside a nested SDK payload", () => {
    logRawProviderError("OpenRouter", { error: { message: "Insufficient Balance" } });

    expect(errorCalls).toHaveLength(0);
    expect(warnCalls).toHaveLength(1);
  });

  it("still reports a genuine provider fault as an error", () => {
    logRawProviderError("DeepseekStreamAdapter", new Error("HTTP 500: Internal Server Error"));

    expect(warnCalls).toHaveLength(0);
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0]).toContain("Provider error");
  });

  it("does not downgrade an affordability ceiling, which is not a dead account", () => {
    logRawProviderError(
      "OpenRouter",
      new Error("HTTP 402: This request requires more credits, or fewer max_tokens. You can only afford 7783."),
    );

    expect(warnCalls).toHaveLength(0);
    expect(errorCalls).toHaveLength(1);
  });
});
