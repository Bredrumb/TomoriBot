import { beforeAll, describe, expect, it } from "bun:test";
import { AnthropicStreamAdapter } from "@/providers/anthropic/anthropicStreamAdapter";
import { CustomStreamAdapter } from "@/providers/custom/customStreamAdapter";
import { DeepseekStreamAdapter } from "@/providers/deepseek/deepseekStreamAdapter";
import { GoogleStreamAdapter } from "@/providers/google/googleStreamAdapter";
import { NovelaiStreamAdapter } from "@/providers/novelai/novelaiStreamAdapter";
import { NvidiaStreamAdapter } from "@/providers/nvidia/nvidiaStreamAdapter";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { VertexStreamAdapter } from "@/providers/vertex/vertexStreamAdapter";
import { VertexexpressStreamAdapter } from "@/providers/vertexexpress/vertexexpressStreamAdapter";
import { ZaiStreamAdapter } from "@/providers/zai/zaiStreamAdapter";
import type { ProviderError } from "@/types/stream/interfaces";
import { formatProviderErrorCodeForDisplay } from "@/utils/provider/providerErrorClassification";
import { hasLocaleKey, initializeLocalizer, localizer } from "@/utils/text/localizer";
import providerLocale from "@/locales/en-US/providers";
import { RUNTIME_LOCALES, collectCaseFailures, localizedCopy } from "../../helpers/localeCases";
import { ConfiguredModelUnavailableError, createProviderToolFailure } from "@/utils/provider/providerToolFailure";
import { CredentialUnavailableError } from "@/utils/provider/credentialResolver";
import { RemoteUrlPolicyError } from "@/utils/security/userRemoteFetch";

// A synthetic credential an endpoint reflects back, in the encodings a pattern redactor misses.
const CANARY = "sk-live-CANARY0001";
const ECHOES = [
  CANARY,
  Buffer.from(CANARY).toString("base64"),
  encodeURIComponent(`Bearer ${CANARY}`).replace(/-/g, "%2D"),
  Buffer.from(CANARY).toString("hex"),
];
const INJECTED = "@everyone <@123456789012345678> <@&42>";
const FORBIDDEN = ["CANARY", ...ECHOES.slice(1), "@everyone", "<@"];

const describers: Array<[string, (error: ProviderError, locale?: string) => string | null]> = [
  ["anthropic", (error, locale = "en-US") => new AnthropicStreamAdapter().createErrorDescription(error, locale)],
  ["openrouter", (error, locale = "en-US") => new OpenrouterStreamAdapter().createErrorDescription(error, locale)],
  ["google", (error, locale = "en-US") => new GoogleStreamAdapter().createErrorDescription(error, locale)],
  ["vertex", (error, locale = "en-US") => new VertexStreamAdapter().createErrorDescription(error, locale)],
  [
    "vertexexpress",
    (error, locale = "en-US") => new VertexexpressStreamAdapter().createErrorDescription(error, locale),
  ],
  ["novelai", (error, locale = "en-US") => new NovelaiStreamAdapter().createErrorDescription(error, locale)],
  ["nvidia", (error, locale = "en-US") => new NvidiaStreamAdapter().createErrorDescription(error, locale)],
  ["custom", (error, locale = "en-US") => new CustomStreamAdapter().createErrorDescription(error, locale)],
  ["deepseek", (error, locale = "en-US") => new DeepseekStreamAdapter().createErrorDescription(error, locale)],
  ["zai", (error, locale = "en-US") => new ZaiStreamAdapter().createErrorDescription(error, locale)],
];

const types: ProviderError["type"][] = [
  "model_error",
  "api_error",
  "provider_overloaded",
  "rate_limit",
  "timeout",
  "content_blocked",
  "unknown",
];
const codes = [
  "400",
  "500",
  "599",
  CANARY,
  "vertex_config_error",
  "vertex_auth_error",
  "invalid_request_error",
  undefined,
];

describe("public provider error descriptions", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it.each(
    describers.filter(([name]) => name !== "vertex" && name !== "vertexexpress"),
  )("resolves every supported genai.%s error key across locales", (name, describeError) => {
    const prefix = `genai.${name}`;
    const suffixes = Object.keys(providerLocale.genai[name as keyof typeof providerLocale.genai]);
    const providerKeys = suffixes.map((suffix) => `${prefix}.${suffix}`);
    const candidateKeys = [
      ...providerKeys,
      "genai.stream.model_error_description",
      "genai.stream.provider_overloaded_description",
      "genai.stream.connection_refused_description",
    ];
    const reachableCodes = new Set([
      ...codes,
      "ECONNREFUSED",
      ...suffixes
        .filter((suffix) => suffix.endsWith("_default_message"))
        .map((suffix) => suffix.replace(/(?:_parameter)?_default_message$/, "")),
    ]);
    const failures = collectCaseFailures();
    for (const locale of RUNTIME_LOCALES) {
      const copies = candidateKeys.map((key) => {
        expect(hasLocaleKey(locale, key) || hasLocaleKey("en-US", key)).toBe(true);
        return localizer(locale, key);
      });
      for (const type of types) {
        for (const code of reachableCodes) {
          for (const message of ["Provider failure", "Unsupported request parameter temperature"]) {
            failures.check(`${locale}/${type}/${code}/${message}`, () => {
              const rendered = describeError({ type, code, message, retryable: false }, locale);
              expect(rendered).not.toMatch(/genai\.[a-zA-Z0-9_.-]+/);
              expect(copies.some((copy) => rendered?.includes(copy))).toBe(true);
            });
          }
        }
      }
    }
    failures.expectNoFailures();
  });

  it("never repeat upstream text, echoed credentials or injected mentions", () => {
    const leaks: string[] = [];
    for (const [name, describe] of describers) {
      for (const type of types) {
        for (const code of codes) {
          for (const echo of ECHOES) {
            const upstream = `Invalid key ${echo} ${INJECTED} Unsupported model. Privacy Policy Error billing`;
            const description = describe({
              type,
              code,
              message: upstream,
              userMessage: upstream,
              originalError: new Error(upstream),
              retryable: false,
            });
            const found = FORBIDDEN.filter((fragment) => description?.includes(fragment));
            if (!description?.trim() || found.length > 0) {
              leaks.push(`${name}/${type}/${code}: ${found.join(", ") || "empty"}`);
            }
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it("classifies tool failures across locales and keeps provider text out of reasons and guidance", () => {
    const failures = collectCaseFailures();
    const cases = [
      { error: { code: "PROHIBITED_CONTENT" }, code: "PROHIBITED_CONTENT", key: "content_blocked" },
      {
        error: { code: "PROHIBITED_CONTENT", message: "Unsupported model" },
        code: "PROHIBITED_CONTENT",
        key: "content_blocked",
      },
      {
        error: { message: "Provider stopped with PROHIBITED_CONTENT" },
        code: "PROHIBITED_CONTENT",
        key: "content_blocked",
      },
      { error: { message: 'Request rejected: {"error":{"code":403}}' }, code: "403", key: "authentication" },
      { error: { status: 429 }, code: "429", key: "rate_limit" },
      { error: { status: 402 }, code: "402", key: "quota" },
      { error: { status: 503 }, code: "503", key: "provider_overloaded" },
      { error: { error: { code: "invalid_api_key", status: 401 } }, code: "invalid_api_key", key: "authentication" },
      { error: { message: "Request timed out" }, code: "timeout", key: "timeout" },
      { error: { code: CANARY }, code: "provider_error", key: "provider_error" },
    ];
    for (const locale of RUNTIME_LOCALES) {
      for (const testCase of cases) {
        for (const echo of ECHOES) {
          failures.check(`${locale}/${testCase.key}/${testCase.code}/${echo}`, () => {
            const result = createProviderToolFailure(
              { message: `Unexpected failure ${echo} ${INJECTED}`, ...testCase.error },
              {
                locale,
                provider: "google",
                credentialScope: "personal",
              },
            );
            expect(result.success).toBe(false);
            expect(result.failure?.code).toBe(testCase.code);
            const copyLocale = hasLocaleKey(locale, `genai.tool_failure.${testCase.key}`) ? locale : "en-US";
            expect(result.failure?.reason).toBe(localizedCopy(copyLocale, `genai.tool_failure.${testCase.key}`));
            expect(result.error).toBe(result.failure?.reason);
            const serialized = JSON.stringify(result);
            for (const fragment of FORBIDDEN) expect(serialized).not.toContain(fragment);
            expect(serialized).not.toMatch(/genai\.[a-zA-Z0-9_.-]+/);
          });
        }
      }
    }
    failures.expectNoFailures();
    const auth = createProviderToolFailure(
      { status: 401 },
      { locale: "en-US", provider: "google", credentialScope: "personal" },
    );
    expect(auth.failure?.suggestedActions).toContain(localizedCopy("en-US", "genai.tips.verify_api_key_personal"));
    expect(auth.failure?.suggestedActions).not.toContain(localizedCopy("en-US", "genai.tips.verify_api_key"));
  });

  it("drops the chat reply-length tip, which no tool request reads", () => {
    for (const credentialScope of ["server", "personal"] as const) {
      const result = createProviderToolFailure(
        { message: "HTTP 402: This request requires more credits, or fewer max_tokens.", status: 402 },
        { locale: "en-US", provider: "openrouter", credentialScope, kind: "quota" },
      );
      expect(result.failure?.reason).toBe(localizedCopy("en-US", "genai.tool_failure.credit_limit"));
      for (const key of ["genai.tips.reduce_output_tokens", "genai.tips.reduce_output_tokens_personal"]) {
        expect(result.failure?.suggestedActions).not.toContain(localizedCopy("en-US", key));
      }
    }
  });

  const googleBody = (code: number, message: string, status: string) =>
    JSON.stringify({ error: { code, message, status } });
  it.each([
    {
      name: "a Google 429 that reports an exhausted quota",
      error: new Error(
        googleBody(
          429,
          "You exceeded your current quota, please check your plan and billing details.",
          "RESOURCE_EXHAUSTED",
        ),
      ),
      reason: "balance_exhausted",
    },
    {
      name: "a Z.ai 429 that reports an empty balance",
      error: Object.assign(
        new Error(
          'Z.ai image generation failed: 429 Too Many Requests. {"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}',
        ),
        { status: 429 },
      ),
      reason: "balance_exhausted",
    },
    {
      name: "a malformed Google model ID",
      error: new Error(
        googleBody(400, "* GenerateContentRequest.model: unexpected model name format\n", "INVALID_ARGUMENT"),
      ),
      reason: "model_error",
      tip: "check_tool_configuration",
    },
    {
      name: "a retired Veo model",
      error: new Error(
        googleBody(404, "This model models/veo-3.1-generate-preview is no longer available.", "NOT_FOUND"),
      ),
      reason: "model_error",
      tip: "check_tool_configuration",
    },
    {
      name: "a speech model without voice design",
      error: {
        message: `HTTP 400: ${googleBody(400, "Model 'gemini-3.8-flash-lite-tts' does not support Prompted Voice Design.", "INVALID_ARGUMENT")}`,
      },
      kind: "invalid_request" as const,
      reason: "model_error",
      tip: "check_tool_configuration",
    },
    {
      name: "a speech safety refusal",
      error: {
        message: `HTTP 400: ${googleBody(400, "Voice prompt was blocked by safety policies.", "INVALID_ARGUMENT")}`,
      },
      kind: "invalid_request" as const,
      reason: "content_blocked",
      tip: "revise_tool_request",
    },
    {
      name: "a provider with no saved configuration",
      error: new CredentialUnavailableError("google", "image-standard", "no_saved_config"),
      reason: "not_configured",
      tip: "check_tool_configuration",
    },
  ])("classifies $name from production", ({ error, kind, reason, tip }) => {
    const result = createProviderToolFailure(error, {
      locale: "en-US",
      provider: "google",
      credentialScope: "server",
      kind,
    });
    expect(result.failure?.reason).toBe(localizedCopy("en-US", `genai.tool_failure.${reason}`));
    expect(result.failure?.suggestedActions).not.toContain(localizedCopy("en-US", "genai.tips.wait_and_retry"));
    if (tip) expect(result.failure?.suggestedActions).toEqual([localizedCopy("en-US", `genai.tips.${tip}`)]);
  });

  it("tells the host's refusal of an endpoint address apart from a provider failure", () => {
    const result = createProviderToolFailure(
      new RemoteUrlPolicyError(
        "Localhost is not allowed for this endpoint. ALLOW_PRIVATE_NETWORK does not list 127.0.0.1:8000.",
        "127.0.0.1",
        "PRODUCTION_LOCALHOST_FORBIDDEN",
      ),
      { locale: "en-US", provider: "custom", credentialScope: "personal" },
    );
    expect(result.failure?.code).toBe("PRIVATE_NETWORK_BLOCKED");
    expect(result.failure?.reason).toBe(localizedCopy("en-US", "genai.tool_failure.endpoint_blocked"));
    expect(result.failure?.suggestedActions).toEqual([
      localizedCopy("en-US", "genai.tips.endpoint_not_allowed_personal"),
    ]);
    expect(result.failure?.reason).not.toContain("ALLOW_PRIVATE_NETWORK");
  });

  it("names configured model files only through the dedicated error", () => {
    const result = createProviderToolFailure(
      new ConfiguredModelUnavailableError("ComfyUI prompt failed: 400 Bad Request", ["anima.safetensors"], 400),
      { locale: "en-US", provider: "custom", credentialScope: "server" },
    );
    expect(result.failure?.code).toBe("400");
    expect(result.failure?.reason).toBe(
      localizedCopy("en-US", "genai.tool_failure.model_files_missing", { models: "anima.safetensors" }),
    );
    expect(result.failure?.suggestedActions).toEqual([localizedCopy("en-US", "genai.tips.check_tool_configuration")]);
  });

  it("shows only status and enum-shaped codes", () => {
    expect(
      ["429", "429_balance", "404_model", "ECONNREFUSED", "invalid_request_error"].map(
        formatProviderErrorCodeForDisplay,
      ),
    ).toEqual(["429", "429_balance", "404_model", "ECONNREFUSED", "invalid_request_error"]);
    for (const code of [CANARY, "sk_live_Abc123", "AbcDef", "a".repeat(41), "<@&42>", "", null, undefined]) {
      expect(formatProviderErrorCodeForDisplay(code)).toBe("unknown");
    }
  });
});
