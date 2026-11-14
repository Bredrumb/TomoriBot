import { formatDocumentEmbeddingInput, type StructuredDocumentChunk } from "@/utils/documents/documentChunker";
import { withProviderUsageContext } from "@/utils/provider/providerUsage";
import {
  createProviderUsageRecorder,
  findProviderRequestDeniedError,
  type ProviderRequestDeniedError,
} from "@/utils/provider/providerUsage";
import type { APIAttachment } from "discord.js";
import type { ServerMemoryRow } from "@/types/db/schema";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { llmModelRepo, ragRepository, serverMemoryRepository } from "@/utils/db/repositories";
import { rebuildDocumentTextContent } from "@/utils/documents/documentService";
import { extractTextFromBuffer } from "@/utils/documents/textExtractor";
import { generateEmbeddingsBatched, providerSupportsEmbeddingTaskType } from "@/utils/embeddings/embeddingProvider";
import { getMemoryLimits, validateMemoryContent } from "@/utils/misc/memoryLimits";
import {
  CredentialUnavailableError,
  getResolvedCapabilityModelId,
  PersonalProviderRequiredError,
  resolveCapabilityCredentials,
} from "@/utils/provider/credentialResolver";
import { redactProviderDetail, reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import { createProviderToolFailure } from "@/utils/provider/providerToolFailure";
import { memoryGuard, reserveDocumentQuota } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";

export interface DocumentListRow {
  document_id: number;
  document_name: string;
  first_chunk: string | null;
  channel_disc_ids: string[];
  channel_scope_pending: boolean;
  isHistory: boolean;
}

export interface DocumentChunkRow {
  document_chunk_id: number;
  chunk_index: number;
  content: string;
}

export type DocumentWriteResult =
  | { status: "forbidden" | "rag-disabled" | "memory-critical" }
  | { status: "invalid-name" | "invalid-file" | "file-too-large" | "download-failed" }
  | { status: "empty-content" | "content-too-long" | "too-many-chunks" | "document-limit" | "chunk-limit" }
  | { status: "duplicate" | "quota-exceeded" | "credentials-missing" | "model-missing" | "not-found" }
  | { status: "write-failed" }
  | { status: "provider-denied"; denied: ProviderRequestDeniedError }
  | { status: "success"; documentId: number; documentName: string; chunkCount: number };

export interface AddDocumentInput {
  serverId: number;
  personaId: number | null;
  userId: number;
  userDiscId: string;
  workspaceId: string;
  configuredEmbeddingModelId: number | null;
  isBlacklisted: boolean;
  canManage: boolean;
  memteachingEnabled: boolean;
  documentName: string;
  attachment: APIAttachment | undefined;
  channelDiscIds: string[];
}

export interface VectorizeMemoryInput {
  serverId: number;
  personaId: number;
  personaLineageId: number;
  memoryId: number;
  userId: number;
  userDiscId: string;
  workspaceId: string;
  configuredEmbeddingModelId: number | null;
  isBlacklisted: boolean;
  canManage: boolean;
  memteachingEnabled: boolean;
  content: string;
  documentName: string;
  channelDiscIds: string[];
}

export type VectorizeMemoryResult =
  | DocumentWriteResult
  | { status: "partial-failure"; documentId: number; documentName: string; chunkCount: number };

export type DocumentRemoveResult =
  | { status: "forbidden" | "not-found" | "write-failed" }
  | { status: "success"; documentName: string };

export type ChunkEditResult =
  | { status: "forbidden" | "not-found" | "empty-content" | "content-too-long" }
  | { status: "credentials-missing" | "model-missing" | "write-failed" | "unchanged" }
  | { status: "provider-denied"; denied: ProviderRequestDeniedError }
  | { status: "success" };

export type ChunkRemoveResult =
  | { status: "forbidden" | "not-found" | "write-failed" }
  | { status: "success"; removedDocument: boolean };

export type DocumentReembedResult =
  | { status: "forbidden" | "rag-disabled" | "memory-critical" | "credentials-missing" | "model-missing" }
  | { status: "nothing-to-reembed" | "reembed-failed" }
  | { status: "provider-denied"; denied: ProviderRequestDeniedError }
  | { status: "success"; documentCount: number };

function validAttachment(attachment: APIAttachment): boolean {
  const filename = attachment.filename.toLowerCase();
  const extensionAllowed = [".txt", ".md", ".pdf"].some((extension) => filename.endsWith(extension));
  const contentTypeAllowed = ["text/plain", "text/markdown", "application/pdf"].includes(attachment.content_type ?? "");
  return extensionAllowed || contentTypeAllowed;
}

async function resolveEmbedding(serverId: number, userId: number | null, configuredModelId: number | null) {
  try {
    const credentials = await resolveCapabilityCredentials(serverId, "embedding", { userId });
    const modelId = getResolvedCapabilityModelId(credentials, "embedding") ?? configuredModelId;
    if (!modelId) return { status: "model-missing" as const };
    const model = await llmModelRepo.loadEmbeddingModelById(modelId);
    if (!model?.embedding_model_id) return { status: "model-missing" as const };
    return { status: "success" as const, credentials, model, embeddingModelId: model.embedding_model_id };
  } catch (error) {
    const denied = findProviderRequestDeniedError(error);
    if (denied) return { status: "provider-denied" as const, denied };
    if (error instanceof CredentialUnavailableError && error.reason === "missing_model_id") {
      return { status: "model-missing" as const };
    }
    if (error instanceof PersonalProviderRequiredError || error instanceof CredentialUnavailableError) {
      return { status: "credentials-missing" as const };
    }
    throw error;
  }
}

async function embedChunks(
  chunks: StructuredDocumentChunk[],
  resolved: Extract<Awaited<ReturnType<typeof resolveEmbedding>>, { status: "success" }>,
): Promise<number[][] | { status: "provider-denied"; denied: ProviderRequestDeniedError }> {
  return withProviderUsageContext(resolved.credentials.usageContext, async () =>
    generateEmbeddingsBatched({
      provider: resolved.model.provider,
      apiKey: resolved.credentials.apiKey,
      model: resolved.model.codename,
      modelId: resolved.model.embedding_model_id,
      inputs: chunks.map((chunk) => formatDocumentEmbeddingInput(chunk.content, chunk.headingPath)),
      taskType: (await providerSupportsEmbeddingTaskType(resolved.model.provider)) ? "RETRIEVAL_DOCUMENT" : undefined,
      batchSize: 16,
      onUsage: createProviderUsageRecorder(resolved.credentials.usageContext, resolved.model.codename),
    }),
  ).catch((error: unknown) => {
    const denied = findProviderRequestDeniedError(error, resolved.credentials.usageContext);
    if (denied) return { status: "provider-denied" as const, denied };
    throw error;
  });
}

export const serverDocumentsOperations = {
  async add(input: AddDocumentInput): Promise<DocumentWriteResult> {
    if (!input.canManage) return { status: "forbidden" };
    if (!isRagAvailable()) return { status: "rag-disabled" };
    if (memoryGuard.checkMemory().status === "critical") return { status: "memory-critical" };

    const documentName = input.documentName.trim();
    if (!documentName || documentName.length > 64) return { status: "invalid-name" };
    if (!input.attachment || !validAttachment(input.attachment)) return { status: "invalid-file" };

    const limits = getMemoryLimits();
    if (input.attachment.size > limits.maxDocumentSizeMB * 1024 * 1024) return { status: "file-too-large" };
    if (await serverMemoryRepository.documentExistsByName(input.serverId, input.personaId, documentName)) {
      return { status: "duplicate" };
    }
    if (
      (await serverMemoryRepository.countDocumentsScoped(input.serverId, input.personaId)) >=
      limits.maxDocumentsPerServer
    ) {
      return { status: "document-limit" };
    }

    const resolved = await resolveEmbedding(input.serverId, input.userId, input.configuredEmbeddingModelId);
    if (resolved.status !== "success") return resolved;

    const download = await safeDownload(input.attachment.url, {
      maxSizeMB: limits.maxDocumentSizeMB,
      timeoutMs: 20000,
      knownSize: input.attachment.size,
    });
    if (!download.success || !download.buffer) return { status: "download-failed" };

    const extracted = await extractTextFromBuffer(
      download.buffer,
      input.attachment.filename,
      input.attachment.content_type,
    );
    const normalized = ragRepository.normalizeText(extracted);
    if (!normalized) return { status: "empty-content" };
    if (normalized.length > limits.maxDocumentTextLength) return { status: "content-too-long" };

    const chunks = ragRepository.chunkText(normalized);
    if (chunks.length === 0) return { status: "empty-content" };
    if (chunks.length > limits.maxDocumentChunks) return { status: "too-many-chunks" };
    const existingChunks = await serverMemoryRepository.countChunksScoped(input.serverId, input.personaId);
    if (existingChunks + chunks.length > limits.maxDocumentChunksPerServer) return { status: "chunk-limit" };

    if (!reserveDocumentQuota(input.userDiscId).allowed) return { status: "quota-exceeded" };
    const embeddings = await embedChunks(chunks, resolved);
    if (!Array.isArray(embeddings)) return embeddings;
    const documentId = await ragRepository.insertWithChunks({
      serverId: input.serverId,
      personaId: input.personaId,
      uploaderUserId: input.userId,
      documentName,
      fileName: input.attachment.filename,
      mimeType: input.attachment.content_type ?? null,
      fileSizeBytes: input.attachment.size,
      textContent: normalized,
      chunks: chunks.map((chunk) => chunk.content),
      headingPaths: chunks.map((chunk) => chunk.headingPath),
      embeddings,
      embeddingModelId: resolved.embeddingModelId,
      embeddingFamily: resolved.model.model_family,
      channelDiscIds: input.channelDiscIds,
    });
    invalidateTomoriStateCache(input.workspaceId);
    return { status: "success", documentId, documentName, chunkCount: chunks.length };
  },

  async remove(input: {
    serverId: number;
    personaId: number | null;
    documentId: number;
    workspaceId: string;
    isBlacklisted: boolean;
    canManage: boolean;
    memteachingEnabled: boolean;
    historyOnly: boolean;
  }): Promise<DocumentRemoveResult> {
    if (!input.canManage) return { status: "forbidden" };
    const documents = input.historyOnly
      ? await serverMemoryRepository.loadHistoryDocuments(input.serverId, input.personaId)
      : await serverMemoryRepository.loadDocuments(input.serverId, input.personaId);
    if (!documents.some((document) => document.document_id === input.documentId)) return { status: "not-found" };
    const documentName = input.historyOnly
      ? await serverMemoryRepository.removeHistoryDocument(input.documentId, input.serverId, input.personaId)
      : await serverMemoryRepository.removeDocument(input.documentId, input.serverId, input.personaId);
    if (!documentName) return { status: "write-failed" };
    invalidateTomoriStateCache(input.workspaceId);
    return { status: "success", documentName };
  },

  async editChunk(input: {
    serverId: number;
    personaId: number | null;
    documentId: number;
    chunkIdx: number;
    workspaceId: string;
    userId: number;
    configuredEmbeddingModelId: number | null;
    canManage: boolean;
    content: string;
    channelDiscIds: string[];
  }): Promise<ChunkEditResult> {
    if (!input.canManage) return { status: "forbidden" };
    const meta = await serverMemoryRepository.loadDocumentMeta(input.documentId, input.serverId, input.personaId);
    const chunks = await serverMemoryRepository.loadDocumentChunks(input.documentId, input.serverId, input.personaId);
    const target = chunks.find((chunk) => chunk.chunk_index === input.chunkIdx);
    if (!meta || !target) return { status: "not-found" };
    const content = input.content.trim();
    if (!content) return { status: "empty-content" };
    if (content.length > 4000) return { status: "content-too-long" };
    const contentChanged = content !== target.content;
    const normalizedCurrentScope = [...meta.channel_disc_ids].sort();
    const normalizedNextScope = [...input.channelDiscIds].sort();
    const scopeChanged =
      meta.channel_scope_pending || normalizedCurrentScope.join(",") !== normalizedNextScope.join(",");
    if (!contentChanged && !scopeChanged) return { status: "unchanged" };
    if (contentChanged) {
      const resolved = await resolveEmbedding(input.serverId, input.userId, input.configuredEmbeddingModelId);
      if (resolved.status !== "success") return resolved;
      const embedded = await embedChunks([{ content, headingPath: target.heading_path }], resolved);
      if (!Array.isArray(embedded)) return embedded;
      const [embedding] = embedded;
      if (!embedding) return { status: "write-failed" };
      const updated = await serverMemoryRepository.updateChunk({
        chunkId: target.document_chunk_id,
        serverId: input.serverId,
        personaId: input.personaId,
        content,
        embeddingVector: ragRepository.formatVector(embedding),
        embeddingModelId: resolved.embeddingModelId,
        embeddingFamily: resolved.model.model_family,
      });
      if (!updated) return { status: "write-failed" };
      invalidateTomoriStateCache(input.workspaceId);
      await rebuildDocumentTextContent(input.documentId);
      invalidateTomoriStateCache(input.workspaceId);
    }
    if (scopeChanged) {
      const updated = await serverMemoryRepository.updateDocumentChannelScope(
        input.documentId,
        input.serverId,
        input.channelDiscIds,
        input.personaId,
      );
      if (!updated) return { status: "write-failed" };
      invalidateTomoriStateCache(input.workspaceId);
    }
    return { status: "success" };
  },

  async removeChunk(input: {
    serverId: number;
    personaId: number | null;
    documentId: number;
    chunkIdx: number;
    workspaceId: string;
    canManage: boolean;
  }): Promise<ChunkRemoveResult> {
    if (!input.canManage) return { status: "forbidden" };
    const meta = await serverMemoryRepository.loadDocumentMeta(input.documentId, input.serverId, input.personaId);
    const chunks = await serverMemoryRepository.loadDocumentChunks(input.documentId, input.serverId, input.personaId);
    const target = chunks.find((chunk) => chunk.chunk_index === input.chunkIdx);
    if (!meta || !target) return { status: "not-found" };
    if (!(await serverMemoryRepository.deleteChunk(target.document_chunk_id, input.serverId, input.personaId))) {
      return { status: "write-failed" };
    }
    invalidateTomoriStateCache(input.workspaceId);
    if (chunks.length === 1) {
      if (!(await serverMemoryRepository.removeDocument(input.documentId, input.serverId, input.personaId))) {
        return { status: "write-failed" };
      }
      invalidateTomoriStateCache(input.workspaceId);
      return { status: "success", removedDocument: true };
    }
    await rebuildDocumentTextContent(input.documentId);
    invalidateTomoriStateCache(input.workspaceId);
    return { status: "success", removedDocument: false };
  },

  async vectorize(input: VectorizeMemoryInput): Promise<VectorizeMemoryResult> {
    if (!input.canManage) return { status: "forbidden" };
    if (!isRagAvailable()) return { status: "rag-disabled" };
    if (memoryGuard.checkMemory().status === "critical") return { status: "memory-critical" };
    const memories = await serverMemoryRepository.loadServerMemoriesScoped(input.serverId, input.personaLineageId);
    const target = memories.find((memory) => memory.server_memory_id === input.memoryId);
    if (!target) return { status: "not-found" };
    return vectorizeLoadedMemory(input, target);
  },

  async reembed(input: {
    serverId: number;
    workspaceId: string;
    configuredEmbeddingModelId: number | null;
    canManage: boolean;
  }): Promise<DocumentReembedResult> {
    if (!input.canManage) return { status: "forbidden" };
    if (!isRagAvailable()) return { status: "rag-disabled" };
    if (memoryGuard.checkMemory().status === "critical") return { status: "memory-critical" };

    // Pass null so re-embedding uses server credentials rather than a manager's personal BYOK key.
    const resolved = await resolveEmbedding(input.serverId, null, input.configuredEmbeddingModelId);
    if (resolved.status !== "success") return resolved;

    const documentCount = await serverMemoryRepository.countMismatchedEmbeddingDocuments(
      input.serverId,
      resolved.model.model_family,
    );
    if (documentCount === 0) return { status: "nothing-to-reembed" };

    try {
      await withProviderUsageContext(resolved.credentials.usageContext, async () =>
        ragRepository.reembedServerDocuments({
          serverId: input.serverId,
          embeddingModel: resolved.model,
          apiKey: resolved.credentials.apiKey,
          onUsage: createProviderUsageRecorder(resolved.credentials.usageContext, resolved.model.codename),
        }),
      );
      return { status: "success", documentCount };
    } catch (error) {
      const denied = findProviderRequestDeniedError(error, resolved.credentials.usageContext);
      if (denied) return { status: "provider-denied", denied };

      const rootError = error instanceof Error && error.cause !== undefined ? error.cause : error;
      const toolFailure = createProviderToolFailure(rootError, {
        locale: "en-US",
        provider: resolved.model.provider,
        credentialScope: resolved.credentials.source,
      }).failure;
      const detail = rootError instanceof Error ? rootError.message : String(rootError);
      const code = toolFailure?.code ?? "unknown";
      await reportProviderFailure({
        summary: "Document re-embedding failed",
        errorType: "DocumentReembedFailed",
        error: rootError,
        detail: redactProviderDetail(detail, resolved.credentials.apiKey),
        expected:
          resolved.credentials.source === "personal" ||
          ["401", "402", "403", "429", "timeout", "authentication", "quota", "rate_limit", "content_blocked"].includes(
            code,
          ),
        serverId: input.serverId,
        dimensions: {
          operation: "document_reembed",
          provider: resolved.model.provider,
          model: resolved.model.codename,
          code,
        },
        redactValues: resolved.credentials.apiKey ? [resolved.credentials.apiKey] : [],
      });
      return { status: "reembed-failed" };
    }
  },
};

async function vectorizeLoadedMemory(
  input: VectorizeMemoryInput,
  target: ServerMemoryRow,
): Promise<VectorizeMemoryResult> {
  const limits = getMemoryLimits();
  const content = input.content.trim();
  const documentName = input.documentName.trim();
  if (!validateMemoryContent(content).isValid) return { status: content ? "content-too-long" : "empty-content" };
  if (!documentName || documentName.length > 64) return { status: "invalid-name" };
  if (await serverMemoryRepository.documentExistsByName(input.serverId, input.personaId, documentName)) {
    return { status: "duplicate" };
  }
  if (
    (await serverMemoryRepository.countDocumentsScoped(input.serverId, input.personaId)) >= limits.maxDocumentsPerServer
  ) {
    return { status: "document-limit" };
  }
  const normalized = ragRepository.normalizeText(content);
  const chunks = ragRepository.chunkText(normalized);
  if (chunks.length === 0) return { status: "empty-content" };
  if (chunks.length > limits.maxDocumentChunks) return { status: "too-many-chunks" };
  const currentChunkCount = await serverMemoryRepository.countChunksScoped(input.serverId, input.personaId);
  if (currentChunkCount + chunks.length > limits.maxDocumentChunksPerServer) return { status: "chunk-limit" };
  const resolved = await resolveEmbedding(input.serverId, input.userId, input.configuredEmbeddingModelId);
  if (resolved.status !== "success") return resolved;
  if (!reserveDocumentQuota(input.userDiscId).allowed) return { status: "quota-exceeded" };
  const embeddings = await embedChunks(chunks, resolved);
  if (!Array.isArray(embeddings)) return embeddings;
  const documentId = await ragRepository.insertWithChunks({
    serverId: input.serverId,
    personaId: input.personaId,
    uploaderUserId: input.userId,
    documentName,
    fileName: null,
    mimeType: null,
    fileSizeBytes: null,
    textContent: normalized,
    chunks: chunks.map((chunk) => chunk.content),
    headingPaths: chunks.map((chunk) => chunk.headingPath),
    embeddings,
    embeddingModelId: resolved.embeddingModelId,
    embeddingFamily: resolved.model.model_family,
    sourceType: "memory",
    channelDiscIds: input.channelDiscIds,
  });
  invalidateTomoriStateCache(input.workspaceId);
  if (!target.server_memory_id || !(await serverMemoryRepository.remove(target.server_memory_id))) {
    return { status: "partial-failure", documentId, documentName, chunkCount: chunks.length };
  }
  invalidateTomoriStateCache(input.workspaceId);
  return { status: "success", documentId, documentName, chunkCount: chunks.length };
}
