import { chunkStructuredDocument } from "@/utils/documents/documentChunker";
import {
  insertDocumentWithChunks,
  retrieveRelevantDocumentChunks,
  reembedServerDocuments,
  normalizeDocumentText,
  formatVector,
  formatRetrievedChunksForPrompt,
  type RetrievedDocumentChunk,
} from "@/utils/documents/documentService";
import { detectRagAvailability, isRagAvailable } from "@/utils/db/ragAvailability";
import type { IRepository } from "./IRepository";

type RagExportShape = {
  server_disc_id: string;
  document_count: number;
};

class RagRepository implements IRepository<RagExportShape> {
  isAvailable(): boolean {
    return isRagAvailable();
  }

  async detectAvailability(
    ...args: Parameters<typeof detectRagAvailability>
  ): ReturnType<typeof detectRagAvailability> {
    return detectRagAvailability(...args);
  }

  normalizeText(text: string): string {
    return normalizeDocumentText(text);
  }

  chunkText(text: string): ReturnType<typeof chunkStructuredDocument> {
    return chunkStructuredDocument(text);
  }

  formatVector(values: number[]): string {
    return formatVector(values);
  }

  formatChunksForPrompt(chunks: RetrievedDocumentChunk[]): string | null {
    return formatRetrievedChunksForPrompt(chunks);
  }

  async retrieveRelevantChunks(
    ...args: Parameters<typeof retrieveRelevantDocumentChunks>
  ): ReturnType<typeof retrieveRelevantDocumentChunks> {
    return retrieveRelevantDocumentChunks(...args);
  }

  async insertWithChunks(
    ...args: Parameters<typeof insertDocumentWithChunks>
  ): ReturnType<typeof insertDocumentWithChunks> {
    return insertDocumentWithChunks(...args);
  }

  async reembedServerDocuments(
    ...args: Parameters<typeof reembedServerDocuments>
  ): ReturnType<typeof reembedServerDocuments> {
    return reembedServerDocuments(...args);
  }

  async toExportShape(ownerId: string | number): Promise<RagExportShape | null> {
    return { server_disc_id: String(ownerId), document_count: 0 };
  }

  async fromExportShape(_ownerId: string | number, _data: RagExportShape): Promise<boolean> {
    return false;
  }
}

export const ragRepository = new RagRepository();
