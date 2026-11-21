import { afterEach, expect, it, mock, spyOn } from "bun:test";
import { generateConversationSummaryCustom } from "@/providers/custom/customCompactGenerator";
import { log } from "@/utils/misc/logger";
import { STUB_PUBLIC_HOST, stubGlobalFetch } from "../../helpers/fetchStub";

afterEach(() => mock.restore());

it("counts unsupported custom summary models as warnings and keeps malformed requests as incidents", async () => {
  const errors = spyOn(log, "error").mockResolvedValue(undefined);
  const warnings = spyOn(log, "warn").mockImplementation(() => {});
  const metrics = spyOn(log, "metric").mockImplementation(() => {});
  const apiKey = "fixture-summary-secret";
  for (const [code, message, expected] of [
    ["model_not_supported", "Model example 4.1 is not supported on /v1/chat/completions.", true],
    ["invalid_request", "Invalid request field: max_tokens", false],
  ] as const) {
    errors.mockClear();
    warnings.mockClear();
    metrics.mockClear();
    const fetch = stubGlobalFetch(() => Response.json({ error: { code, message, detail: apiKey } }, { status: 400 }));
    try {
      const result = await generateConversationSummaryCustom({
        endpointUrl: `https://${STUB_PUBLIC_HOST}/v1`,
        apiKey,
        model: "example 4.1",
        userPrompt: "Summarize a quiet afternoon.",
      });
      expect(result.summary).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error).not.toContain(apiKey);
      expect(result.error).not.toContain(message);
      expect(errors).toHaveBeenCalledTimes(expected ? 0 : 1);
      expect(warnings).toHaveBeenCalledTimes(expected ? 1 : 0);
      expect(metrics).toHaveBeenCalledTimes(expected ? 1 : 0);
      const call = expected ? warnings.mock.calls[0] : errors.mock.calls[0];
      expect(call?.[0]).toContain("HTTP 400");
      expect(call?.[0]).toContain(code);
      expect(call?.[0]).not.toContain(apiKey);
    } finally {
      fetch.mockRestore();
    }
  }
});
