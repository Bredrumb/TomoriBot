import { describe, expect, it } from "bun:test";
import { normalizeZaiRequestSamplingParams, roundZaiTopP } from "@/providers/zai/zaiRequestParams";

describe("Z.ai request parameter normalization", () => {
  it("rounds top_p to Z.ai's two-decimal precision limit", () => {
    expect(roundZaiTopP(0.949999988079071)).toBe(0.95);
    expect(roundZaiTopP(0.944)).toBe(0.94);
    expect(roundZaiTopP(0.945)).toBe(0.95);
  });

  it("normalizes numeric top_p on the request body", () => {
    const requestBody: Record<string, unknown> = {
      top_p: 0.949999988079071,
      temperature: 1,
    };

    normalizeZaiRequestSamplingParams(requestBody);

    expect(requestBody.top_p).toBe(0.95);
    expect(requestBody.temperature).toBe(1);
  });

  it("leaves omitted or non-numeric top_p unchanged", () => {
    const omittedBody: Record<string, unknown> = {};
    const stringBody: Record<string, unknown> = { top_p: "0.949999988079071" };

    normalizeZaiRequestSamplingParams(omittedBody);
    normalizeZaiRequestSamplingParams(stringBody);

    expect(omittedBody).not.toHaveProperty("top_p");
    expect(stringBody.top_p).toBe("0.949999988079071");
  });
});
