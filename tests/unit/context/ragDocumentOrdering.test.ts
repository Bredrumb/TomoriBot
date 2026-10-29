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
import { embeddingModelSchema, savedProviderConfigSchema } from "@/types/db/schema";
import { ContextItemTag } from "@/types/misc/context";
import { createPersona } from "../../helpers/fixtures";

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

function chunk(documentId: number, documentName: string, chunkIndex: number, content: string): RetrievedDocumentChunk {
  return {
    document_id: documentId,
    document_name: documentName,
    chunk_index: chunkIndex,
    content,
    similarity: 0.9,
  };
}

function installSpies() {
  return {
    warn: spyOn(log, "warn").mockImplementation(() => undefined),
    metric: spyOn(log, "metric").mockImplementation(() => undefined),
    sample: spyOn(metricSampleRepository, "recordSample").mockResolvedValue(undefined),
    ragAvailable: spyOn(ragAvailability, "isRagAvailable").mockReturnValue(true),
    memory: spyOn(memoryGuard, "getStatus").mockReturnValue("safe"),
    documents: spyOn(serverMemoryRepository, "hasDocumentInScope").mockResolvedValue(true),
    credentials: spyOn(credentialResolver, "resolveCapabilityCredentials").mockResolvedValue(credentials),
    model: spyOn(llmModelRepo, "loadEmbeddingModelById").mockResolvedValue(embeddingModel),
    retrieve: spyOn(ragRepository, "retrieveRelevantChunks").mockResolvedValue([]),
  };
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

async function render(chunks: RetrievedDocumentChunk[]): Promise<string> {
  spies.retrieve.mockResolvedValue(chunks);
  const item = await buildServerDocumentContextItem({
    tomoriState: createPersona({ config: { embedding_model_id: 3 } }),
    simplifiedMessageHistory: [userMessage("fixture query")],
    channelId: "fixture-channel",
  });
  expect(item?.metadataTag).toBe(ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS);
  if (!item) throw new Error("Expected a document context item");
  const [part] = item.parts;
  if (part?.type !== "text") throw new Error("Expected a text part");
  return part.text;
}

beforeEach(() => {
  spies = installSpies();
});

afterEach(() => {
  for (const spy of Object.values(spies)) spy.mockRestore();
});

describe("RAG document rendering order", () => {
  const selectedChunks = [
    chunk(2, "Beta notes", 1, "B1"),
    chunk(1, "Alpha notes", 0, "A0"),
    chunk(2, "Beta notes", 0, "B0"),
    chunk(1, "Alpha notes", 1, "A1"),
  ];

  it("renders rank permutations of the same selected chunks identically", async () => {
    const first = await render(selectedChunks);
    const reversed = await render([...selectedChunks].reverse());
    const interleaved = await render([selectedChunks[1], selectedChunks[3], selectedChunks[2], selectedChunks[0]]);

    expect(reversed).toBe(first);
    expect(interleaved).toBe(first);
    expect(first).toContain("Alpha notes:\nA0\nA1\n\nBeta notes:\nB0\nB1");
  });

  it("renders a different selected set differently", async () => {
    const first = await render(selectedChunks);
    const different = await render([
      chunk(2, "Beta notes", 1, "B2"),
      chunk(1, "Alpha notes", 0, "A0"),
      chunk(2, "Beta notes", 0, "B0"),
      chunk(1, "Alpha notes", 1, "A1"),
    ]);

    expect(different).not.toBe(first);
    expect(different).toContain("B2");
    expect(different).not.toContain("B1");
  });
});
