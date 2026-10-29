import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { llmModelRepo, ragRepository, serverMemoryRepository } from "@/utils/db/repositories";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";
import * as ragAvailability from "@/utils/db/ragAvailability";
import type { RetrievedDocumentChunk } from "@/utils/documents/documentService";
import { log } from "@/utils/misc/logger";
import * as credentialResolver from "@/utils/provider/credentialResolver";
import { memoryGuard } from "@/utils/security/rateLimiter";
import { buildServerDocumentContextItem } from "@/utils/text/context/rag";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";
import { charsToTokensText } from "@/utils/text/tokenEstimate";
import { embeddingModelSchema, savedProviderConfigSchema } from "@/types/db/schema";
import { ContextItemTag } from "@/types/misc/context";
import { createPersona } from "../../helpers/fixtures";

interface MetricCall {
  name: string;
  fields: Record<string, number | string>;
}

const savedConfig = savedProviderConfigSchema.parse({
  server_id: 1,
  provider: "openrouter",
  api_key: Buffer.from("fixture-encrypted-key"),
  llm_id: null,
  diffusion_model_id: null,
  embedding_model_id: null,
  nai_diffusion_model_id: null,
  nai_preset_name: null,
  llm_disabled_params: [],
  llm_logit_biases: [],
  fallback_model_refs: [],
});

const credentials: credentialResolver.ResolvedCredentials = {
  provider: "openrouter",
  apiKey: "fixture-key",
  keyVersion: 1,
  source: "server",
  savedConfig,
};

const embeddingModel = embeddingModelSchema.parse({
  embedding_model_id: 3,
  provider: "openrouter",
  codename: "fixture-embedding",
  model_family: "fixture",
});

const retrievedChunk: RetrievedDocumentChunk = {
  document_id: 1,
  document_name: "Mirri notes",
  chunk_index: 0,
  content: "The archive key is under the bridge.",
  similarity: 0.91,
};

let metricCalls: MetricCall[] = [];

function installSpies() {
  metricCalls = [];
  const spies = {
    metric: spyOn(log, "metric").mockImplementation((name, fields) => {
      metricCalls.push({ name, fields });
    }),
    warn: spyOn(log, "warn").mockImplementation(() => undefined),
    sample: spyOn(metricSampleRepository, "recordSample").mockResolvedValue(undefined),
    ragAvailable: spyOn(ragAvailability, "isRagAvailable").mockReturnValue(true),
    memory: spyOn(memoryGuard, "getStatus").mockReturnValue("safe"),
    documents: spyOn(serverMemoryRepository, "hasDocumentInScope").mockResolvedValue(true),
    credentials: spyOn(credentialResolver, "resolveCapabilityCredentials").mockResolvedValue(credentials),
    model: spyOn(llmModelRepo, "loadEmbeddingModelById").mockResolvedValue(embeddingModel),
    retrieve: spyOn(ragRepository, "retrieveRelevantChunks").mockResolvedValue([]),
  };
  return spies;
}

let spies: ReturnType<typeof installSpies>;

function userMessage(content: string): SimplifiedMessageForContext {
  return {
    id: "fixture-message",
    authorId: "1",
    authorName: "Juno",
    authorType: "user",
    content,
    imageAttachments: [],
    videoAttachments: [],
  };
}

function build(overrides: Partial<Parameters<typeof buildServerDocumentContextItem>[0]> = {}) {
  return buildServerDocumentContextItem({
    tomoriState: createPersona({ config: { embedding_model_id: 3 } }),
    simplifiedMessageHistory: [userMessage("fixture query")],
    channelId: "fixture-channel",
    ...overrides,
  });
}

function expectRecordedOutcome(outcome: string): Record<string, number | string> {
  if (metricCalls.length !== 1) throw new Error(`Expected one metric, received ${metricCalls.length}`);
  const [call] = metricCalls;
  if (!call) throw new Error("Expected one metric");
  expect(call.name).toBe("rag_retrieval");
  expect(call.fields.outcome).toBe(outcome);
  expect(Number.isFinite(call.fields.total_ms)).toBe(true);
  expect(spies.sample).toHaveBeenCalledTimes(1);
  return call.fields;
}

beforeEach(() => {
  spies = installSpies();
});

afterEach(() => {
  for (const spy of Object.values(spies)) spy.mockRestore();
});

describe("RAG retrieval telemetry", () => {
  it("records rag_unavailable when pgvector is missing", async () => {
    spies.ragAvailable.mockReturnValue(false);
    expect(await build()).toBeNull();
    expectRecordedOutcome("rag_unavailable");
  });

  it("records memory_critical under critical memory pressure", async () => {
    spies.memory.mockReturnValue("critical");
    expect(await build()).toBeNull();
    expectRecordedOutcome("memory_critical");
  });

  it("records no_server when no server state resolves", async () => {
    expect(await build({ tomoriState: null })).toBeNull();
    expectRecordedOutcome("no_server");
  });

  it("records no_query when history holds no user message", async () => {
    expect(await build({ simplifiedMessageHistory: [] })).toBeNull();
    expectRecordedOutcome("no_query");
  });

  it("records query_too_short for a shortened query", async () => {
    expect(await build({ simplifiedMessageHistory: [userMessage("hi")] })).toBeNull();
    expectRecordedOutcome("query_too_short");
  });

  it("records no_documents when the server has no document in scope", async () => {
    spies.documents.mockResolvedValue(false);
    expect(await build()).toBeNull();
    expectRecordedOutcome("no_documents");
  });

  it("records no_model when no embedding model resolves", async () => {
    spies.model.mockResolvedValue(null);
    expect(await build()).toBeNull();
    expectRecordedOutcome("no_model");
  });

  it("records no_results when retrieval returns nothing", async () => {
    expect(await build()).toBeNull();
    expectRecordedOutcome("no_results");
  });

  it("records injected with the retrieval limit, phase timings, and injected size", async () => {
    spies.retrieve.mockImplementation(async (params) => {
      if (params.timings) {
        params.timings.embeddingMs = 12.4;
        params.timings.sqlMs = 7.6;
      }
      return [retrievedChunk];
    });

    const item = await build();

    expect(item?.metadataTag).toBe(ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS);
    expect(spies.retrieve.mock.calls[0]?.[0].maxResults).toBe(10);
    const fields = expectRecordedOutcome("injected");
    expect(fields.embedding_ms).toBe(12);
    expect(fields.sql_ms).toBe(8);
    expect(fields.result_count).toBe(1);
    expect(typeof fields.injected_chars).toBe("number");
    expect(fields.injected_tokens).toBe(charsToTokensText(Number(fields.injected_chars)));
    // Aggregate fields only: no query text, document text, names, or identifiers may reach a metric.
    expect(Object.entries(fields).filter(([key, value]) => key !== "outcome" && typeof value === "string")).toEqual([]);
  });

  it("records error when a precondition throws", async () => {
    spies.documents.mockRejectedValue(new Error("fixture database unavailable"));
    expect(await build()).toBeNull();
    expectRecordedOutcome("error");
  });
});
