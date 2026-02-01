import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { generateEmbeddingsBatched } from "@/utils/embeddings/embeddingProvider";
import type { EmbeddingModelRow } from "@/types/db/schema";

export interface RetrievedDocumentChunk {
	document_id: number;
	document_name: string;
	chunk_index: number;
	content: string;
	similarity: number;
}

export function normalizeDocumentText(text: string): string {
	return text
		.replaceAll("\u0000", "")
		.replace(/\r\n/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function chunkDocumentText(
	text: string,
	chunkSize: number,
	overlap: number,
): string[] {
	const chunks: string[] = [];

	if (chunkSize <= 0) {
		return chunks;
	}

	const safeOverlap = Math.max(
		0,
		Math.min(overlap, Math.max(0, chunkSize - 1)),
	);
	let start = 0;

	while (start < text.length) {
		const end = Math.min(start + chunkSize, text.length);
		const chunk = text.slice(start, end).trim();
		if (chunk.length > 0) {
			chunks.push(chunk);
		}
		if (end >= text.length) {
			break;
		}
		start = Math.max(0, end - safeOverlap);
	}

	return chunks;
}

export function formatVector(values: number[]): string {
	return `[${values.join(",")}]`;
}

export async function insertDocumentWithChunks(params: {
	serverId: number;
	uploaderUserId: number | null;
	documentName: string;
	fileName: string | null;
	mimeType: string | null;
	fileSizeBytes: number | null;
	textContent: string;
	chunks: string[];
	embeddings: number[][];
	embeddingModelId: number;
	embeddingFamily: string;
}): Promise<number> {
	const {
		serverId,
		uploaderUserId,
		documentName,
		fileName,
		mimeType,
		fileSizeBytes,
		textContent,
		chunks,
		embeddings,
		embeddingModelId,
		embeddingFamily,
	} = params;

	if (chunks.length !== embeddings.length) {
		throw new Error(
			`Chunk count (${chunks.length}) does not match embedding count (${embeddings.length})`,
		);
	}

	return sql.transaction(async (tx) => {
		const [documentRow] = await tx`
			INSERT INTO documents (
				server_id,
				uploader_user_id,
				document_name,
				file_name,
				mime_type,
				file_size_bytes,
				text_content
			) VALUES (
				${serverId},
				${uploaderUserId},
				${documentName},
				${fileName},
				${mimeType},
				${fileSizeBytes},
				${textContent}
			)
			RETURNING document_id
		`;

		if (!documentRow?.document_id) {
			throw new Error("Failed to insert document row");
		}

		const documentId = Number(documentRow.document_id);

		for (let i = 0; i < chunks.length; i += 1) {
			const embeddingVector = formatVector(embeddings[i]);
			await tx`
				INSERT INTO document_chunks (
					document_id,
					server_id,
					embedding_model_id,
					embedding_family,
					chunk_index,
					content,
					embedding
				) VALUES (
					${documentId},
					${serverId},
					${embeddingModelId},
					${embeddingFamily},
					${i},
					${chunks[i]},
					${embeddingVector}::vector
				)
			`;
		}

		return documentId;
	});
}

export async function retrieveRelevantDocumentChunks(params: {
	serverId: number;
	query: string;
	embeddingModel: EmbeddingModelRow;
	apiKey: string;
	maxResults: number;
	minSimilarity: number;
	batchSize?: number;
}): Promise<RetrievedDocumentChunk[]> {
	const {
		serverId,
		query,
		embeddingModel,
		apiKey,
		maxResults,
		minSimilarity,
		batchSize,
	} = params;

	if (!query.trim()) {
		return [];
	}

	const queryEmbeddings = await generateEmbeddingsBatched({
		provider: embeddingModel.provider as "google" | "openrouter",
		apiKey,
		model: embeddingModel.codename,
		inputs: [query],
		taskType:
			embeddingModel.provider === "google" ? "RETRIEVAL_QUERY" : undefined,
		batchSize,
	});

	if (queryEmbeddings.length === 0) {
		return [];
	}

	const queryVector = formatVector(queryEmbeddings[0]);

	const rows = await sql<
		Array<{
			document_id: number;
			document_name: string;
			chunk_index: number;
			content: string;
			distance: number | string;
		}>
	>`
		SELECT dc.document_id,
		       d.document_name,
		       dc.chunk_index,
		       dc.content,
		       (dc.embedding <=> ${queryVector}::vector) AS distance
		FROM document_chunks dc
		JOIN documents d ON d.document_id = dc.document_id
		WHERE dc.server_id = ${serverId}
		  AND dc.embedding_family = ${embeddingModel.model_family}
		ORDER BY dc.embedding <=> ${queryVector}::vector
		LIMIT ${maxResults}
	`;

	const results: RetrievedDocumentChunk[] = [];
	for (const row of rows) {
		const distance =
			typeof row.distance === "string"
				? Number.parseFloat(row.distance)
				: Number(row.distance);
		const similarity = Number.isFinite(distance) ? 1 - distance : 0;
		if (similarity < minSimilarity) {
			continue;
		}
		results.push({
			document_id: row.document_id,
			document_name: row.document_name,
			chunk_index: row.chunk_index,
			content: row.content,
			similarity,
		});
	}

	return results;
}

export function formatRetrievedChunksForPrompt(
	chunks: RetrievedDocumentChunk[],
	maxChars: number,
): string | null {
	if (!chunks.length) {
		return null;
	}

	let output = "# Server Documents (Chunks referenced through RAG)\n";
	let currentDoc = "";

	for (const chunk of chunks) {
		if (chunk.document_name !== currentDoc) {
			const header = `\n## ${chunk.document_name}\n`;
			if (output.length + header.length > maxChars) {
				break;
			}
			output += header;
			currentDoc = chunk.document_name;
		}

		const scoreText = `score ${chunk.similarity.toFixed(2)}`;
		const line = `- [Chunk ${chunk.chunk_index + 1}, ${scoreText}] ${chunk.content}\n`;
		if (output.length + line.length > maxChars) {
			break;
		}
		output += line;
	}

	const trimmed = output.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export async function reembedServerDocuments(params: {
	serverId: number;
	embeddingModel: EmbeddingModelRow;
	apiKey: string;
	chunkSize: number;
	chunkOverlap: number;
}): Promise<void> {
	const { serverId, embeddingModel, apiKey, chunkSize, chunkOverlap } = params;

	if (!embeddingModel.embedding_model_id) {
		throw new Error("Embedding model ID is missing for re-embedding");
	}

	const documents = await sql<
		Array<{
			document_id: number;
			text_content: string;
		}>
	>`
		SELECT document_id, text_content
		FROM documents
		WHERE server_id = ${serverId}
		ORDER BY document_id ASC
	`;

	for (const document of documents) {
		const normalized = normalizeDocumentText(document.text_content);
		const chunks = chunkDocumentText(normalized, chunkSize, chunkOverlap);

		if (chunks.length === 0) {
			log.warn(
				`Skipping empty document during re-embed: ${document.document_id}`,
			);
			continue;
		}

		const embeddings = await generateEmbeddingsBatched({
			provider: embeddingModel.provider as "google" | "openrouter",
			apiKey,
			model: embeddingModel.codename,
			inputs: chunks,
			taskType:
				embeddingModel.provider === "google" ? "RETRIEVAL_DOCUMENT" : undefined,
			batchSize: 16,
		});

		await sql.transaction(async (tx) => {
			await tx`
				DELETE FROM document_chunks
				WHERE document_id = ${document.document_id}
			`;

			for (let i = 0; i < chunks.length; i += 1) {
				const embeddingVector = formatVector(embeddings[i]);
				await tx`
					INSERT INTO document_chunks (
						document_id,
						server_id,
					embedding_model_id,
					embedding_family,
					chunk_index,
					content,
					embedding
				) VALUES (
					${document.document_id},
					${serverId},
					${embeddingModel.embedding_model_id},
					${embeddingModel.model_family},
					${i},
					${chunks[i]},
					${embeddingVector}::vector
				)
				`;
			}
		});
	}
}
