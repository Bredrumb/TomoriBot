import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { callOpenrouterStructuredJSON } from "@/providers/openrouter/openrouterStructuredOutput";
import { callDeepseekStructuredJSON } from "@/providers/deepseek/deepseekStructuredOutput";
import { callZaiStructuredJSON } from "@/providers/zai/zaiStructuredOutput";
import { callNvidiaStructuredJSON } from "@/providers/nvidia/nvidiaStructuredOutput";
import { callAnthropicStructuredJSON } from "@/providers/anthropic/anthropicStructuredOutput";
import { draftReviewResultSchema } from "@/utils/chat/responseReview";
import { log } from "@/utils/misc/logger";
import type { ProviderStructuredJsonRequest } from "@/types/provider/featureInterfaces";
import { STUB_PUBLIC_HOST, stubGlobalFetch } from "../../helpers/fetchStub";
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { callGoogleStructuredJSON } from "@/providers/google/googleStructuredOutput";
import { callCustomStructuredJSON } from "@/providers/custom/customStructuredOutput";
import { NVIDIA_STRUCTURED_OUTPUT_MODELS } from "@/providers/nvidia/nvidiaConstants";

const request: ProviderStructuredJsonRequest = {
  model: "fixture",
  apiKey: "PRIVATE_KEY",
  systemPrompt: "PRIVATE_PROTOCOL",
  userPrompt: "PRIVATE_EVIDENCE",
  maxOutputTokens: 1024,
  privateOutput: true,
};

describe("private structured review transports", () => {
  const errors = spyOn(log, "error").mockImplementation(async () => {});
  const info = spyOn(log, "info").mockImplementation(() => {});
  afterEach(() => {
    errors.mockClear();
    info.mockClear();
  });
  afterAll(() => {
    errors.mockRestore();
    info.mockRestore();
  });

  it("validates output and reports usage even for refusals and malformed reviews without logging bodies", async () => {
    let respond: Parameters<typeof stubGlobalFetch>[0] = () => Response.json({});
    const fetchSpy = stubGlobalFetch((url, init) => respond(url, init));
    try {
      for (const [content, refusal, expected] of [
        [JSON.stringify({ status: "pass" }), null, true],
        ["PRIVATE_RESPONSE", null, false],
        [null, "PRIVATE_REFUSAL", false],
      ] as const) {
        const usage: unknown[] = [];
        const controller = new AbortController();
        respond = async (_url, init) => {
          expect(init?.signal).toBe(controller.signal);
          return Response.json({
            choices: [{ message: { content, refusal } }],
            usage: { prompt_tokens: 12, completion_tokens: 3 },
          });
        };
        const result = await callOpenrouterStructuredJSON(
          { ...request, abortSignal: controller.signal, onUsage: (value) => usage.push(value) },
          {},
          draftReviewResultSchema,
          "response_review",
        );
        expect(result.success).toBe(expected);
        expect(usage).toEqual([{ inputTokens: 12, outputTokens: 3 }]);
        if (refusal) expect(result).toMatchObject({ failure: "refusal" });
        expect(errors).not.toHaveBeenCalled();
        expect(info).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain("PRIVATE_");
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("propagates cancellation and disables structured mode retries for private requests", async () => {
    let respond: Parameters<typeof stubGlobalFetch>[0] = () => Response.json({});
    const fetchSpy = stubGlobalFetch((url, init) => respond(url, init));
    try {
      let calls = 0;
      respond = async () => {
        calls++;
        return new Response("PRIVATE_RESPONSE json_schema unsupported", { status: 400 });
      };
      const nvidiaModel = [...NVIDIA_STRUCTURED_OUTPUT_MODELS][0];
      const result = await callNvidiaStructuredJSON({ ...request, model: nvidiaModel }, {}, draftReviewResultSchema);
      expect(result).toMatchObject({ success: false, failure: "transport", httpStatus: 400 });
      expect(calls).toBe(1);
      const controller = new AbortController();
      controller.abort();
      respond = async (_url, init) => {
        expect(init?.signal?.aborted).toBe(true);
        throw new Error("PRIVATE_KEY PRIVATE_EVIDENCE");
      };
      const cancelled = await callOpenrouterStructuredJSON(
        { ...request, abortSignal: controller.signal },
        {},
        draftReviewResultSchema,
        "response_review",
      );
      expect(cancelled).toMatchObject({ success: false, failure: "cancelled" });
      expect(errors).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("bounds decoded output and HTTP bodies", async () => {
    let respond: Parameters<typeof stubGlobalFetch>[0] = () => Response.json({});
    const fetchSpy = stubGlobalFetch((url, init) => respond(url, init));
    try {
      respond = () => Response.json({ choices: [{ message: { content: "x".repeat(17000) } }] });
      expect(await callOpenrouterStructuredJSON(request, {}, draftReviewResultSchema, "response_review")).toMatchObject(
        { success: false, failure: "malformed" },
      );
      respond = () => new Response("x".repeat(1024 * 1024 + 1));
      const oversized = await callOpenrouterStructuredJSON(request, {}, draftReviewResultSchema, "response_review");
      expect(oversized.success).toBe(false);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps provider-specific structured APIs on the same private result and usage contract", async () => {
    let respond: Parameters<typeof stubGlobalFetch>[0] = () => Response.json({});
    const fetchSpy = stubGlobalFetch((url, init) => respond(url, init));
    try {
      const usage: unknown[] = [];
      respond = () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({ status: "pass" }) } }],
          usage: { prompt_tokens: 9, completion_tokens: 1 },
        });
      for (const call of [callDeepseekStructuredJSON, callZaiStructuredJSON, callNvidiaStructuredJSON]) {
        const result = await call(
          { ...request, model: [...NVIDIA_STRUCTURED_OUTPUT_MODELS][0], onUsage: (value) => usage.push(value) },
          {},
          draftReviewResultSchema,
        );
        expect(result).toMatchObject({ success: true, data: { status: "pass" } });
      }
      respond = () =>
        Response.json({
          content: [{ type: "tool_use", name: "response_review", input: { status: "pass" } }],
          usage: { input_tokens: 5, output_tokens: 1 },
        });
      const result = await callAnthropicStructuredJSON(
        { ...request, onUsage: (value) => usage.push(value) },
        {},
        draftReviewResultSchema,
        "response_review",
      );
      expect(result).toMatchObject({ success: true, data: { status: "pass" } });
      respond = () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({ status: "pass" }) } }],
          usage: { prompt_tokens: 4, completion_tokens: 1 },
        });
      const custom = await callCustomStructuredJSON(
        { ...request, endpointUrl: `https://${STUB_PUBLIC_HOST}/v1`, onUsage: (value) => usage.push(value) },
        {},
        draftReviewResultSchema,
      );
      expect(custom).toMatchObject({ success: true, data: { status: "pass" } });
      expect(usage).toHaveLength(5);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it("preserves Google native refusal and usage through the same private contract", async () => {
    const client = new GoogleGenAI({ apiKey: "fixture" });
    const response = new GenerateContentResponse();
    response.usageMetadata = { promptTokenCount: 7, candidatesTokenCount: 1 };
    response.candidates = [{ content: { parts: [{ text: JSON.stringify({ status: "pass" }) }] } }];
    const generate = spyOn(client.models, "generateContent").mockResolvedValue(response);
    const usage: unknown[] = [];
    const controller = new AbortController();
    try {
      const result = await callGoogleStructuredJSON(
        { ...request, abortSignal: controller.signal, onUsage: (value) => usage.push(value) },
        {},
        draftReviewResultSchema,
        client,
      );
      expect(result).toMatchObject({ success: true, data: { status: "pass" } });
      expect(generate.mock.calls[0]?.[0].config?.abortSignal).toBe(controller.signal);
      response.promptFeedback = {
        blockReason: "SAFETY" as NonNullable<GenerateContentResponse["promptFeedback"]>["blockReason"],
      };
      expect(
        await callGoogleStructuredJSON(
          { ...request, onUsage: (value) => usage.push(value) },
          {},
          draftReviewResultSchema,
          client,
        ),
      ).toMatchObject({ success: false, failure: "refusal" });
      expect(usage).toHaveLength(2);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      generate.mockRestore();
    }
  });
});
