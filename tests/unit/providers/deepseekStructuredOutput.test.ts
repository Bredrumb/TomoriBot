import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { callDeepseekStructuredJSON } from "@/providers/deepseek/deepseekStructuredOutput";
import { DeepseekProvider } from "@/providers/deepseek/deepseekProvider";
import {
  generateConversationSummaryDeepseek,
  generateRoleplaySummaryDeepseek,
} from "@/providers/deepseek/compactGenerator";
import * as imageProcessor from "@/utils/image/imageProcessor";
import { z } from "zod";

describe("DeepSeek structured output", () => {
  const originalFetch = globalThis.fetch;
  const originalBatchSize = process.env.DEEPSEEK_EXPRESSION_BATCH_SIZE;
  let imageSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    imageSpy?.mockRestore();
    imageSpy = undefined;
    if (originalBatchSize !== undefined) {
      process.env.DEEPSEEK_EXPRESSION_BATCH_SIZE = originalBatchSize;
    } else {
      delete process.env.DEEPSEEK_EXPRESSION_BATCH_SIZE;
    }
  });

  it("formats multimodal image inputs into OpenAI-compatible image_url parts", async () => {
    imageSpy = spyOn(imageProcessor, "fetchAndOptimizeImage").mockResolvedValue({
      data: "base64data",
      mimeType: "image/png",
    });

    let capturedRequestBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedRequestBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ emotion: "joy", confidence: 0.95 }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const schema = {
      type: "object",
      properties: {
        emotion: { type: "string" },
        confidence: { type: "number" },
      },
      required: ["emotion", "confidence"],
    };

    const zodSchema = z.object({
      emotion: z.string(),
      confidence: z.number(),
    });

    const result = await callDeepseekStructuredJSON(
      {
        apiKey: "test-deepseek-key",
        model: "deepseek-v4-flash-vision",
        systemPrompt: "You are an emotion analyzer.",
        userPrompt: "Analyze this image.",
        images: [{ url: "https://example.com/smile.png", mimeType: "image/png", name: "smile" }],
      },
      schema,
      zodSchema,
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.data).toEqual({ emotion: "joy", confidence: 0.95 });

    expect(capturedRequestBody).not.toBeNull();
    if (!capturedRequestBody) throw new Error("Expected captured request body");
    const messages = capturedRequestBody.messages as Array<{ role: string; content: unknown }>;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");

    const userContent = messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(Array.isArray(userContent)).toBe(true);
    expect(userContent).toHaveLength(2);
    expect(userContent[0]).toEqual({ type: "text", text: "Analyze this image." });
    expect(userContent[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,base64data" },
    });
  });

  it("parses JSON wrapped in markdown fences and think tags", async () => {
    globalThis.fetch = (async () => {
      const payload = '<think>Analyzing emotion...</think>\n```json\n{\n  "status": "ok"\n}\n```';
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: payload } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await callDeepseekStructuredJSON(
      {
        apiKey: "test-deepseek-key",
        model: "deepseek-v4-flash",
        systemPrompt: "system",
        userPrompt: "user",
      },
      { type: "object", properties: { status: { type: "string" } } },
      z.object({ status: z.string() }),
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.data).toEqual({ status: "ok" });
  });

  it("provides expression initialization batch size with default and env override", () => {
    const provider = new DeepseekProvider();
    expect(provider.getExpressionInitializationBatchSize()).toBe(20);

    process.env.DEEPSEEK_EXPRESSION_BATCH_SIZE = "35";
    expect(provider.getExpressionInitializationBatchSize()).toBe(35);
  });

  it("parses JSON arrays containing objects surrounded by conversational text", async () => {
    globalThis.fetch = (async () => {
      const payload = 'Here is the extracted list:\n[ {"name": "foo", "score": 10} ]\nHope this helps!';
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: payload } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await callDeepseekStructuredJSON(
      {
        apiKey: "test-deepseek-key",
        model: "deepseek-v4-flash",
        systemPrompt: "system",
        userPrompt: "user",
      },
      { type: "array", items: { type: "object" } },
      z.array(z.object({ name: z.string(), score: z.number() })),
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.data).toEqual([{ name: "foo", score: 10 }]);
  });

  it("plumbs images and custom endpoint into generateConversationSummaryDeepseek", async () => {
    imageSpy = spyOn(imageProcessor, "fetchAndOptimizeImage").mockResolvedValue({
      data: "compactBase64",
      mimeType: "image/jpeg",
    });

    let requestedUrl: string | null = null;
    let requestBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      requestBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Compacted summary text." } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await generateConversationSummaryDeepseek({
      apiKey: "deepseek-api-key-12345",
      model: "deepseek-v4-flash-vision",
      endpointUrl: "https://custom.deepseek.proxy/v1/chat/completions",
      systemPrompt: "System instruction",
      userPrompt: "Compact these messages",
      images: [{ url: "https://example.com/scene.jpg", mimeType: "image/jpeg" }],
    });

    expect(result.summary).toBe("Compacted summary text.");
    expect(requestedUrl).toBe("https://custom.deepseek.proxy/v1/chat/completions");
    if (!requestBody) throw new Error("Expected request body");
    const messages = requestBody.messages as Array<{ role: string; content: unknown }>;
    expect(messages[1].role).toBe("user");
    const userContent = messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(userContent[0]).toEqual({ type: "text", text: "Compact these messages" });
    expect(userContent[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,compactBase64" },
    });
  });

  it("plumbs images and endpointUrl into generateRoleplaySummaryDeepseek", async () => {
    imageSpy = spyOn(imageProcessor, "fetchAndOptimizeImage").mockResolvedValue({
      data: "roleplayBase64",
      mimeType: "image/png",
    });

    let requestedUrl: string | null = null;
    let requestBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      requestBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ overall_scene_summary: "Scene summary here" }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await generateRoleplaySummaryDeepseek({
      apiKey: "deepseek-api-key-12345",
      model: "deepseek-v4-flash-vision",
      endpointUrl: "https://proxy.deepseek.local/chat/completions",
      systemPrompt: "RP system",
      userPrompt: "RP user",
      images: [{ url: "https://example.com/avatar.png", mimeType: "image/png" }],
    });

    expect(result.summary).toEqual({ overall_scene_summary: "Scene summary here" });
    expect(requestedUrl).toBe("https://proxy.deepseek.local/chat/completions");
    if (!requestBody) throw new Error("Expected request body");
    const messages = requestBody.messages as Array<{ role: string; content: unknown }>;
    const userContent = messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(userContent[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,roleplayBase64" },
    });
  });
});
