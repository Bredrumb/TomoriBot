import { describe, expect, it } from "bun:test";
import {
  buildDegradationAttempts,
  buildTargetedAttempt,
  classifyDegradableError,
  extractRejectedParams,
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

describe("classifyDegradableError", () => {
  it.each([
    [400, "Bad request", "generic_400"],
    [400, "Unsupported parameter: min_p", "parameter_rejection_400"],
    [404, "No endpoints found that support these parameters", "no_endpoints_404"],
    [502, "Bad gateway", "backend_incompatible_502"],
    [401, "Unauthorized", null],
    [429, "Rate limit", null],
    [500, "Internal server error", null],
  ] as const)("classifies status %i", (statusCode, message, expected) => {
    expect(classifyDegradableError({ statusCode, message })).toBe(expected);
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
