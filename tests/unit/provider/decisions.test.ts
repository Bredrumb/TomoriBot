import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { callCustomDecisions } from "@/providers/custom/customDecisions";
import { callOpenRouterDecisions } from "@/providers/openrouter/openrouterDecisions";
import { callDecisionsForProvider } from "@/providers/utils/providerFeatureExecutors";
import type { ProviderDecisionRequest } from "@/types/provider/featureInterfaces";
import { parseOpenRouterDecisionModelList } from "@/utils/cache/openrouterDecisionModelCache";
import { log } from "@/utils/misc/logger";
import { llmModelRepo } from "@/utils/db/repositories";
import { OpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import {
  ProviderRequestDeniedError,
  registerProviderRequestDenialTranslator,
  withProviderUsageContext,
} from "@/utils/provider/providerUsage";

const customReference = { provider: "custom:3", modelId: 8, registrationId: null, customEndpointId: 2 };

const request: ProviderDecisionRequest = {
  reference: { provider: "openrouter", modelId: 7, registrationId: 9, customEndpointId: null },
  model: "typesafe/jev-1.13",
  apiStyle: "openrouter-decisions",
  apiKey: "private-credential",
  inputTokenLimit: 32_000,
  correlationId: "fixture-correlation",
  evidence: "PRIVATE_EVIDENCE",
  questions: [{ type: "predicate", id: "criterion", instructions: "PRIVATE_QUESTION" }],
};

describe("Decision transports", () => {
  const info = spyOn(log, "info").mockImplementation(() => {});
  const error = spyOn(log, "error").mockImplementation(async () => {});
  const warn = spyOn(log, "warn").mockImplementation(() => {});
  afterEach(() => {
    info.mockClear();
    error.mockClear();
    warn.mockClear();
  });
  afterAll(() => {
    info.mockRestore();
    error.mockRestore();
    warn.mockRestore();
  });

  it("preserves validated limit causes without retaining provider prose", async () => {
    for (const status of [402, 403]) {
      const result = await callOpenRouterDecisions(request, async () =>
        Response.json(
          { error: { message: "PRIVATE_PROVIDER_DETAIL", metadata: { limit_source: "openrouter_key_limit" } } },
          { status },
        ),
      );
      expect(result.status).toBe("failed");
      if (result.status !== "failed") throw new Error("Expected failed Decision");
      expect(result.category).toBe("http");
      expect(result.cause).toBeInstanceOf(OpenRouterLimitError);
      expect(result.cause).toMatchObject({ status, limitSource: "openrouter_key_limit" });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER_DETAIL");
    }
  });

  it("preserves a request denial as an expected outcome without logging an operational error", async () => {
    const denied = new ProviderRequestDeniedError(undefined, () => ({
      titleKey: "general.errors.api_key_error_title",
      description: "fixture refusal",
    }));
    const result = await callOpenRouterDecisions(request, async () => {
      throw new Error("wrapped refusal", { cause: denied });
    });
    expect(result).toMatchObject({ status: "denied", errorLogged: false, error: denied });
    expect(error).not.toHaveBeenCalled();
  });

  it("translates an owned provider limit before logging an operational failure", async () => {
    const context = {};
    const denied = new ProviderRequestDeniedError(context, () => ({
      titleKey: "general.errors.api_key_error_title",
      description: "fixture",
    }));
    const dispose = registerProviderRequestDenialTranslator((cause, owner) =>
      owner === context && cause instanceof OpenRouterLimitError ? denied : null,
    );
    try {
      const result = await withProviderUsageContext(context, () =>
        callOpenRouterDecisions(request, async () =>
          Response.json({ error: { metadata: { limit_source: "openrouter_key_limit" } } }, { status: 402 }),
        ),
      );
      expect(result).toMatchObject({ status: "denied", error: denied, errorLogged: false });
      expect(error).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("keeps interleaved Decision denials with their request owner", async () => {
    const first = {};
    const second = {};
    const denied = new ProviderRequestDeniedError(first, () => ({
      titleKey: "general.errors.api_key_error_title",
      description: "fixture",
    }));
    const execute = async () =>
      callOpenRouterDecisions(request, async () => {
        await Promise.resolve();
        throw new Error("wrapped", { cause: denied });
      });
    const [owned, foreign] = await Promise.all([
      withProviderUsageContext(first, execute),
      withProviderUsageContext(second, execute),
    ]);
    expect(owned).toMatchObject({ status: "denied", error: denied, errorLogged: false });
    expect(foreign).toMatchObject({ status: "failed", category: "network", errorLogged: true });
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("translates native and System One requests without chat routes", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json(
        {
          model: "jev-1.13.0",
          answers: { criterion: { type: "noul", noul: 0.75 } },
          usage: { input_tokens: 10, output_tokens: 0, cost: 0.00000042 },
        },
        { headers: { "x-typesafe-request-id": "fixture-id" } },
      );
    };
    const native = await callOpenRouterDecisions(request, fakeFetch);
    const custom = await callCustomDecisions(
      {
        ...request,
        reference: customReference,
        model: "jev-1.13.0",
        apiStyle: "system-one",
        endpointUrl: "https://example.invalid/gateway/v1/",
      },
      fakeFetch,
    );
    expect(calls.map((call) => call.url)).toEqual([
      "https://openrouter.ai/api/alpha/decisions",
      "https://example.invalid/gateway/v1/systemone",
    ]);
    expect(calls[0].body).toEqual({
      model: request.model,
      state: request.evidence,
      questions: { criterion: { type: "noul", instructions: "PRIVATE_QUESTION" } },
    });
    expect(custom).toEqual(native);
    expect(native).toMatchObject({
      status: "completed",
      providerRequestId: "fixture-id",
      actualModel: "jev-1.13.0",
      usage: { inputTokens: 10, costUsd: 0.00000042 },
    });
    expect(error).not.toHaveBeenCalled();
    for (const secret of [request.evidence, request.questions[0].instructions, request.apiKey])
      expect(JSON.stringify(info.mock.calls)).not.toContain(String(secret));
  });

  it("translates ordered OpenAI predicates and normalizes valid refusals", async () => {
    let body: unknown;
    const result = await callCustomDecisions(
      {
        ...request,
        reference: customReference,
        model: "fixture-decisions",
        apiStyle: "openai-decisions",
        endpointUrl: "https://example.invalid",
      },
      async (url, init) => {
        expect(url).toBe("https://example.invalid/v1/decisions");
        body = JSON.parse(String(init?.body));
        return Response.json({
          model: "fixture-decisions",
          answers: [{ type: "refusal", name: "criterion" }],
          usage: { input_tokens: 4, output_tokens: 0 },
        });
      },
    );
    expect(body).toEqual({
      model: "fixture-decisions",
      input: request.evidence,
      questions: [{ type: "predicate", name: "criterion", instructions: "PRIVATE_QUESTION" }],
    });
    expect(result).toMatchObject({ status: "refused", answers: [{ type: "refusal", id: "criterion" }] });
    expect(error).not.toHaveBeenCalled();
  });

  describe("choice questions", () => {
    const choiceRequest: ProviderDecisionRequest = {
      ...request,
      questions: [
        {
          type: "choice",
          id: "topic",
          instructions: "PRIVATE_QUESTION",
          options: [
            { id: "i01", description: "mecha anime: Giant robots." },
            { id: "none", description: "None of the listed topics." },
          ],
        },
      ],
    };
    const named = (answer: unknown) => async () => Response.json({ model: "fixture", answers: { topic: answer } });

    it("encodes options as named criteria and ordered choices, and reads both answer shapes", async () => {
      const bodies: unknown[] = [];
      const native = await callOpenRouterDecisions(choiceRequest, async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          model: "fixture",
          answers: {
            topic: { type: "choice", choice: "i01", probabilities: { i01: 0.8, none: 0.2 }, confidence: 0.6 },
          },
        });
      });
      const ordered = await callCustomDecisions(
        {
          ...choiceRequest,
          reference: customReference,
          apiStyle: "openai-decisions",
          endpointUrl: "https://example.invalid",
        },
        async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return Response.json({
            model: "fixture",
            answers: [
              {
                type: "choice",
                name: "topic",
                choice: "i01",
                probabilities: [
                  { value: "i01", probability: 0.8 },
                  { value: "none", probability: 0.2 },
                ],
              },
            ],
          });
        },
      );
      expect(bodies.map((body) => (body as { questions: unknown }).questions)).toEqual([
        {
          topic: {
            type: "choice",
            instructions: "PRIVATE_QUESTION",
            criteria: { i01: "mecha anime: Giant robots.", none: "None of the listed topics." },
          },
        },
        [
          {
            type: "choice",
            name: "topic",
            instructions: "PRIVATE_QUESTION",
            choices: [
              { value: "i01", description: "mecha anime: Giant robots." },
              { value: "none", description: "None of the listed topics." },
            ],
          },
        ],
      ]);
      const expected = { type: "choice", id: "topic", choice: "i01", probabilities: { i01: 0.8, none: 0.2 } };
      expect(native).toMatchObject({ status: "completed", answers: [expected] });
      expect(ordered).toMatchObject({ status: "completed", answers: [expected] });
    });

    it("rejects a choice outside the options, missing probabilities, or a predicate answer", async () => {
      for (const answer of [
        { type: "choice", choice: "i99", probabilities: { i01: 0.5, none: 0.5 } },
        { type: "choice", choice: "i01", probabilities: { i01: 1 } },
        { type: "choice", choice: "i01", probabilities: { i01: 0.1, none: 0.9 } },
        { type: "choice", choice: "i01", probabilities: { i01: 0.5, none: 0.5, extra: 0 } },
        { type: "noul", noul: 0.9 },
      ]) {
        error.mockClear();
        expect(await callOpenRouterDecisions(choiceRequest, named(answer))).toMatchObject({
          status: "failed",
          category: "malformed",
        });
        expect(error).toHaveBeenCalledTimes(1);
      }
    });
  });

  it("reports malformed membership, duplicates, types, probabilities and truncation once", async () => {
    const payloads = [
      { model: "fixture", answers: {} },
      { model: "fixture", answers: { criterion: { type: "noul", noul: 0.5 }, extra: { type: "noul", noul: 0.5 } } },
      { model: "fixture", answers: { criterion: { type: "predicate", probability: 0.5 } } },
      ...["0.5", -1, 1.1, null].map((noul) => ({ model: "fixture", answers: { criterion: { type: "noul", noul } } })),
      { model: "fixture", answers: { criterion: { type: "noul", noul: 0.5 } }, truncated: true },
    ];
    const bodies = [
      ...payloads.map((payload) => JSON.stringify(payload)),
      '{"model":"fixture","answers":{"criterion":{"type":"noul","noul":0.5},"criterion":{"type":"noul","noul":0.8}}}',
      '{"model":"fixture","answers":{"criterion":{"type":"noul","noul":1e999}}}',
    ];
    for (const body of bodies) {
      error.mockClear();
      const result = await callOpenRouterDecisions(request, async () => new Response(body));
      expect(result).toMatchObject({ status: "failed", category: "malformed", errorLogged: true });
      expect(error).toHaveBeenCalledTimes(1);
    }
  });

  it("retains validated usage when answers fail or the turn stops during response decoding", async () => {
    const reported: unknown[] = [];
    const controller = new AbortController();
    const tracked = { ...request, abortSignal: controller.signal, onUsage: (usage: unknown) => reported.push(usage) };
    const malformed = await callOpenRouterDecisions(tracked, async () =>
      Response.json({ model: request.model, answers: {}, usage: { input_tokens: 17, output_tokens: 2 } }),
    );
    expect(malformed).toMatchObject({ status: "failed", errorLogged: true });
    expect(reported).toEqual([expect.objectContaining({ inputTokens: 17, outputTokens: 2 })]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockClear();
    const cancelled = await callOpenRouterDecisions(
      tracked,
      async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({
                    model: request.model,
                    answers: { criterion: { type: "noul", noul: 0.01 } },
                    usage: { input_tokens: 21, output_tokens: 0 },
                  }),
                ),
              );
            },
            pull(stream) {
              controller.abort();
              stream.close();
            },
          }),
        ),
    );
    expect(cancelled.status).toBe("cancelled");
    expect(reported).toHaveLength(2);
    expect(reported[1]).toMatchObject({ inputTokens: 21, outputTokens: 0 });
    expect(error).not.toHaveBeenCalled();
  });

  it("reports operational failures safely and leaves cancellation and rejected input expected", async () => {
    for (const status of [400, 401, 403, 404, 429, 500]) {
      error.mockClear();
      warn.mockClear();
      const result = await callOpenRouterDecisions(
        request,
        async () => new Response(`PRIVATE_RESPONSE ${request.apiKey}`, { status }),
      );
      expect(result).toMatchObject({ status: "failed", errorLogged: true });
      expect(error.mock.calls.length).toBe(status === 400 ? 1 : 0);
      expect(warn.mock.calls.length).toBe(status === 400 ? 0 : 1);
      const logged = status === 400 ? error.mock.calls : warn.mock.calls;
      expect(logged[0]?.[2]?.metadata).toMatchObject({
        operation: "decision-request",
        httpStatus: status,
        correlation: request.correlationId,
      });
      expect(logged[0]?.[0]).toContain("PRIVATE_RESPONSE");
      expect(JSON.stringify(logged)).not.toContain(request.apiKey);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_RESPONSE");
    }
    error.mockClear();
    warn.mockClear();
    await callOpenRouterDecisions(request, async () => {
      throw new Error("PRIVATE_EVIDENCE PRIVATE_RESPONSE private-credential https://secret.invalid?token=SECRET");
    });
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const records = JSON.stringify(
      warn.mock.calls.map(([message, cause, context]) => ({
        message,
        cause: cause instanceof Error ? { ...cause, message: cause.message, stack: cause.stack } : cause,
        context,
      })),
    );
    expect(records).toContain("PRIVATE_RESPONSE");
    for (const secret of ["private-credential", "SECRET"]) expect(records).not.toContain(secret);
    error.mockClear();
    const abort = new AbortController();
    const cancelled = await callOpenRouterDecisions({ ...request, abortSignal: abort.signal }, async () => {
      abort.abort();
      throw new Error("private abort");
    });
    expect(cancelled.status).toBe("cancelled");
    const invalid = await callOpenRouterDecisions({
      ...request,
      questions: [...request.questions, ...request.questions],
    });
    expect(invalid.status).toBe("invalid-input");
    expect(error).not.toHaveBeenCalled();
  });

  it("requires explicit decision discovery and finite documented metadata", () => {
    const entry = {
      id: "typesafe/jev-1.13",
      context_length: 32000,
      architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
      pricing: { prompt: "0.000000042", completion: "0" },
    };
    const parsed = parseOpenRouterDecisionModelList({
      data: [
        entry,
        { ...entry, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
        { ...entry, context_length: 0 },
        { ...entry, pricing: { prompt: "Infinity", completion: "0" } },
      ],
    });
    expect(parsed.map((model) => model.id)).toEqual([entry.id]);
  });

  it("reports a non-cancellation timeout once", async () => {
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort(new DOMException("fixture", "TimeoutError")),
    );
    try {
      const result = await callOpenRouterDecisions(request, async (_url, init) => {
        throw init.signal?.reason;
      });
      expect(result).toMatchObject({ status: "failed", category: "timeout", errorLogged: true });
      expect(error).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });

  it("reports unexpected executor failures once and preserves expected missing selection", async () => {
    const load = spyOn(llmModelRepo, "loadDecisionModelOptions").mockRejectedValue(
      new Error("PRIVATE_EVIDENCE private-credential"),
    );
    try {
      const execution = { ...request, scope: { kind: "server" as const, ownerId: 1 } };
      expect(await callDecisionsForProvider({ ...execution, reference: null })).toMatchObject({
        status: "unavailable",
        reason: "not-selected",
        errorLogged: false,
      });
      expect(error).not.toHaveBeenCalled();
      expect(await callDecisionsForProvider(execution)).toMatchObject({
        status: "failed",
        category: "unexpected",
        errorLogged: true,
      });
      expect(error).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify(
          error.mock.calls.map(([message, cause, context]) => ({
            message,
            cause: cause instanceof Error ? { ...cause, message: cause.message, stack: cause.stack } : cause,
            context,
          })),
        ),
      ).not.toContain("PRIVATE_EVIDENCE");
      expect(
        JSON.stringify(
          error.mock.calls.map(([message, cause, context]) => ({
            message,
            cause: cause instanceof Error ? { ...cause, message: cause.message, stack: cause.stack } : cause,
            context,
          })),
        ),
      ).not.toContain("private-credential");
    } finally {
      load.mockRestore();
    }
  });

  it("retains expected production failures as warnings with scrubbed diagnostics and no request dumps", async () => {
    const script = `import {callOpenRouterDecisions} from "./src/providers/openrouter/openrouterDecisions";
      const result = await callOpenRouterDecisions(${JSON.stringify(request)}, async () => new Response("PRIVATE_RESPONSE", {status:401}));
      if(result.status !== "failed" || !result.errorLogged) process.exit(1);
      const network = await callOpenRouterDecisions({...${JSON.stringify(request)}, correlationId:"fixture-network"}, async () => {
        throw Object.assign(new Error("PRIVATE_EVIDENCE PRIVATE_QUESTION private-credential"), {response:{body:"PRIVATE_RESPONSE", url:"https://secret.invalid?token=SECRET"}});
      });
      if(network.status !== "failed" || !network.errorLogged) process.exit(1);`;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: process.cwd(),
      env: { ...process.env, RUN_ENV: "production", TEST_PRODUCTION: "false", ERROR_DB_LOGGING_ENABLED: "false" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    const records = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const warnings = records.filter((record) => record.level === 40);
    for (const correlation of [request.correlationId, "fixture-network"]) {
      expect(warnings.filter((record) => record.context?.metadata?.correlation === correlation)).toHaveLength(1);
    }
    expect(records.some((record) => record.level === 50)).toBe(false);
    expect(records.some((record) => record.level === 30)).toBe(false);
    expect(stdout).toContain("PRIVATE_RESPONSE");
    for (const secret of ["SECRET", request.apiKey]) expect(stdout).not.toContain(String(secret));
  });
});
