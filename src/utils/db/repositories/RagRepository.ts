/**
 * RagRepository — manages documents, chunks, and vector embeddings.
 *
 * Wraps documentService.ts (insert, retrieve, re-embed) and ragDetection.ts
 * (pgvector availability check). All RAG-capable reads go through this
 * repository so callers are not coupled to the pgvector extension check.
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import {
  insertDocumentWithChunks,
  retrieveRelevantDocumentChunks,
  reembedServerDocuments,
  normalizeDocumentText,
  chunkDocumentText,
  formatVector,
  formatRetrievedChunksForPrompt,
  type RetrievedDocumentChunk,
} from "@/utils/documents/documentService";
import { detectRagAvailability, isRagAvailable } from "@/utils/db/ragAvailability";
import type { IRepository } from "./IRepository";

/** Portable RAG export shape (expanded in Phase 6 #16.7). */
export type RagExportShape = {
  server_disc_id: string;
  document_count: number;
};

export class RagRepository implements IRepository<RagExportShape> {
  /**
   * Returns true if pgvector is available in the current database.
   * Reads the in-process flag set during startup — no DB round-trip.
   */
  isAvailable(): boolean {
    return isRagAvailable();
  }

  /**
   * Probes the database for pgvector availability.
   * Called during initialization; prefer isAvailable() after boot.
   *
   * @param args - Optional custom SQL client forwarded to detectRagAvailability
   */
  async detectAvailability(
    ...args: Parameters<typeof detectRagAvailability>
  ): ReturnType<typeof detectRagAvailability> {
    return detectRagAvailability(...args);
  }

  /**
   * Normalizes raw document text (strip BOM, normalize whitespace).
   *
   * @param text - Raw input text
   */
  normalizeText(text: string): string {
    return normalizeDocumentText(text);
  }

  /**
   * Splits text into overlapping chunks for embedding.
   *
   * @param chunkSize - Characters per chunk
   * @param overlap   - Overlap characters between adjacent chunks
   */
  chunkText(text: string, chunkSize: number, overlap: number): string[] {
    return chunkDocumentText(text, chunkSize, overlap);
  }

  /**
   * Formats a numeric embedding vector as a pgvector literal string.
   *
   */
  formatVector(values: number[]): string {
    return formatVector(values);
  }

  /**
   * Formats retrieved document chunks into a prompt-ready string.
   *
   * @returns Formatted string or null if chunks is empty
   */
  formatChunksForPrompt(chunks: RetrievedDocumentChunk[]): string | null {
    return formatRetrievedChunksForPrompt(chunks);
  }

  /**
   * Retrieves document chunks relevant to a query using vector similarity.
   *
   */
  async retrieveRelevantChunks(
    ...args: Parameters<typeof retrieveRelevantDocumentChunks>
  ): ReturnType<typeof retrieveRelevantDocumentChunks> {
    return retrieveRelevantDocumentChunks(...args);
  }

  /**
   * Inserts a document and its pre-chunked embeddings in a single transaction.
   *
   * @returns Internal document_id or null on failure
   */
  async insertWithChunks(
    ...args: Parameters<typeof insertDocumentWithChunks>
  ): ReturnType<typeof insertDocumentWithChunks> {
    return insertDocumentWithChunks(...args);
  }

  /**
   * Re-embeds all documents for a server using a new embedding model.
   * Used after a server changes its embedding provider.
   *
   */
  async reembedServerDocuments(
    ...args: Parameters<typeof reembedServerDocuments>
  ): ReturnType<typeof reembedServerDocuments> {
    return reembedServerDocuments(...args);
  }

  /**
   * RAG document export is handled by ImportExportRepository.
   * Stub satisfies IRepository contract pending Phase 6 #16.7.
   *
   * @param ownerId - Discord server snowflake (unused until Phase 6)
   */
  async toExportShape(ownerId: string | number): Promise<RagExportShape | null> {
    return { server_disc_id: String(ownerId), document_count: 0 };
  }

  /**
   * RAG document import is handled by ImportExportRepository.
   * Stub satisfies IRepository contract pending Phase 6 #16.7.
   */
  async fromExportShape(_ownerId: string | number, _data: RagExportShape): Promise<boolean> {
    return false;
  }
}

/** Singleton instance — import this in callers. */
export const ragRepository = new RagRepository();
