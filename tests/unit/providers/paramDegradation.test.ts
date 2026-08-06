import { describe, expect, it } from "bun:test";
import {
  buildDegradationAttempts,
  buildImageStripAttempt,
  buildTargetedAttempt,
  classifyDegradableError,
  extractRejectedParams,
  isMultimodalRejectionError,
  messagesContainImageBlocks,
  stripImageBlocksWithNotice,
} from "@/providers/utils/paramDegradation";

describe("extractRejectedParams", () => {
  const body = {
    model: "example/model",
    messages: [],
    stream: true,
    min_p: 0.1,
    logit_bias: { "123": -100 },
    temperature: 0.8,
  };

  it("extracts all named parameters from the DeepInfra rejection", () => {
    expect(
      extractRejectedParams(
        "The min_p and logit_bias sampling parameters are not yet supported with speculative decoding.",
        body,
      ),
    ).toEqual(["min_p", "logit_bias"]);
  });

  it("extracts a single named parameter", () => {
    expect(extractRejectedParams("Unsupported parameter: temperature", body)).toEqual(["temperature"]);
  });

  it("excludes a named parameter that is absent from the request", () => {
    expect(extractRejectedParams("Unsupported parameter: top_p", body)).toEqual([]);
  });

  it("returns no parameters for a generic message", () => {
    expect(extractRejectedParams("Bad request", body)).toEqual([]);
  });

  it("does not match parameter names inside longer identifiers", () => {
    expect(extractRejectedParams("unsupported my_min_p_override", body)).toEqual([]);
  });
});

describe("buildDegradationAttempts", () => {
  it("builds the degradation ladder in priority order and preserves mandatory keys", () => {
    const attempts = buildDegradationAttempts(
      {
        model: "example/model",
        messages: [{ role: "user", content: [{ type: "image_url" }] }],
        stream: true,
        stream_options: { include_usage: true },
        tools: [{ type: "function" }],
        temperature: 0.8,
        min_p: 0.1,
        custom_option: true,
      },
      {
        mandatoryKeys: new Set(["model", "messages", "stream"]),
        stripImages: () => [{ role: "user", content: [] }],
      },
    );

    expect(attempts.map((attempt) => attempt.label)).toEqual([
      "default",
      "no_stream_options",
      "probe_drop_min_p",
      "probe_drop_temperature",
      "probe_drop_custom_option",
      "strip_images",
      "probe_drop_tools",
      "minimal_payload",
    ]);
    for (const attempt of attempts) {
      expect(attempt.body).toHaveProperty("model");
      expect(attempt.body).toHaveProperty("messages");
      expect(attempt.body).toHaveProperty("stream");
    }
  });

  it("never drops a provider-mandatory reply-shaping key such as thinking", () => {
    // A rung that drops `thinking` while keeping `tools` yields a tool call with no
    // reasoning_content, which DeepSeek then rejects when a later request replays that turn.
    const attempts = buildDegradationAttempts(
      {
        model: "deepseek-chat",
        messages: [],
        stream: true,
        stream_options: { include_usage: true },
        thinking: { type: "enabled" },
        tools: [{ type: "function" }],
        top_k: 40,
        min_p: 0.05,
      },
      { mandatoryKeys: new Set(["model", "messages", "stream", "thinking"]) },
    );

    expect(attempts.map((attempt) => attempt.label)).not.toContain("probe_drop_thinking");
    for (const attempt of attempts) {
      expect(attempt.body).toHaveProperty("thinking");
    }
  });

  it("deduplicates identical serialized bodies", () => {
    const attempts = buildDegradationAttempts(
      { model: "example/model", messages: [], stream: true },
      { mandatoryKeys: new Set(["model", "messages", "stream"]) },
    );

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.label).toBe("default");
  });
});

describe("buildTargetedAttempt", () => {
  it("drops all rejected parameters in one labeled attempt", () => {
    const attempt = buildTargetedAttempt(
      { model: "example/model", messages: [], stream: true, min_p: 0.1, logit_bias: {} },
      ["min_p", "logit_bias"],
    );

    expect(attempt.label).toBe("targeted_drop_min_p+logit_bias");
    expect(attempt.body).toEqual({ model: "example/model", messages: [], stream: true });
  });
});

describe("isMultimodalRejectionError", () => {
  it("recognizes the vLLM missing --enable-multimodal rejection", () => {
    expect(
      isMultimodalRejectionError(
        "ValueError: Received multimodal data but multimodal processing is not enabled. Use --enable-multimodal flag to enable multimodal processing.",
      ),
    ).toBe(true);
  });

  it.each([
    "This model does not support image input",
    "image inputs are not supported for this endpoint",
    "Vision is not enabled for this deployment",
  ])("recognizes other no-vision phrasings: %s", (message) => {
    expect(isMultimodalRejectionError(message)).toBe(true);
  });

  it.each([
    "The min_p and logit_bias sampling parameters are not yet supported",
    "Bad gateway",
    "multimodal model ready",
  ])("ignores unrelated errors: %s", (message) => {
    expect(isMultimodalRejectionError(message)).toBe(false);
  });
});

describe("stripImageBlocksWithNotice", () => {
  it("replaces image blocks with a single notice while keeping text blocks", () => {
    const stripped = stripImageBlocksWithNotice([
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          { type: "text", text: "what is this?" },
        ],
      },
    ]);

    const content = stripped[0]?.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0]?.type).toBe("text");
    expect(String(content[0]?.text)).toContain("An attached image was removed");
    expect(content[1]).toEqual({ type: "text", text: "what is this?" });
  });

  it("collapses multiple removed images into one counted notice", () => {
    const stripped = stripImageBlocksWithNotice([
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "a" } },
          { type: "image", uri: "b" },
        ],
      },
    ]);

    const content = stripped[0]?.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(1);
    expect(String(content[0]?.text)).toContain("2 attached images were removed");
  });

  it("returns messages without image blocks unchanged", () => {
    const messages = [
      { role: "system", content: "instructions" },
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];

    expect(stripImageBlocksWithNotice(messages)).toEqual(messages);
  });
});

describe("messagesContainImageBlocks", () => {
  it("detects image blocks in array content", () => {
    expect(messagesContainImageBlocks([{ role: "user", content: [{ type: "image_url" }] }])).toBe(true);
  });

  it("returns false for string content and text-only arrays", () => {
    expect(
      messagesContainImageBlocks([
        { role: "system", content: "instructions" },
        { role: "user", content: [{ type: "text", text: "hello" }] },
      ]),
    ).toBe(false);
  });
});

describe("buildImageStripAttempt", () => {
  it("builds a labeled attempt with notices and preserves other body keys", () => {
    const attempt = buildImageStripAttempt({
      model: "example/model",
      messages: [{ role: "user", content: [{ type: "image_url" }] }],
      stream: true,
      temperature: 0.8,
    });

    expect(attempt?.label).toBe("targeted_strip_images");
    expect(attempt?.body.temperature).toBe(0.8);
    const content = (attempt?.body.messages as Array<Record<string, unknown>> | undefined)?.[0]?.content as Array<
      Record<string, unknown>
    >;
    expect(content[0]?.type).toBe("text");
  });

  it("returns null when the body carries no image blocks", () => {
    expect(
      buildImageStripAttempt({
        model: "example/model",
        messages: [{ role: "user", content: "text only" }],
        stream: true,
      }),
    ).toBeNull();
  });
});

describe("classifyDegradableError", () => {
  it.each([
    [400, "Bad request", "generic_400"],
    [400, "Unsupported parameter: min_p", "parameter_rejection_400"],
    [404, "No endpoints found that support these parameters", "no_endpoints_404"],
    [502, "Bad gateway", null],
    [401, "Unauthorized", null],
    [429, "Rate limit", null],
    [500, "Internal server error", null],
  ] as const)("classifies status %i", (statusCode, message, expected) => {
    expect(classifyDegradableError({ statusCode, message })).toBe(expected);
  });

  it("treats 502 as degradable only when degradeOn502 is enabled (router-style providers)", () => {
    expect(classifyDegradableError({ statusCode: 502, message: "Bad gateway", degradeOn502: true })).toBe(
      "backend_incompatible_502",
    );
    expect(classifyDegradableError({ statusCode: 502, message: "Bad gateway" })).toBeNull();
  });

  it("supports provider-specific classifiers", () => {
    expect(
      classifyDegradableError({
        statusCode: 422,
        message: "remove stop",
        extraClassifiers: [(error) => error.message.includes("stop")],
      }),
    ).toBe("provider_specific");
  });
});
