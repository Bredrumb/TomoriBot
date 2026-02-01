import { GoogleGenAI } from "@google/genai";
import { OpenRouter } from "@openrouter/sdk";
import { log } from "@/utils/misc/logger";

export type EmbeddingProviderName = "google" | "openrouter";

export type EmbeddingTaskType =
	| "SEMANTIC_SIMILARITY"
	| "CLASSIFICATION"
	| "CLUSTERING"
	| "RETRIEVAL_DOCUMENT"
	| "RETRIEVAL_QUERY"
	| "CODE_RETRIEVAL_QUERY"
	| "QUESTION_ANSWERING"
	| "FACT_VERIFICATION";

export interface EmbeddingRequest {
	provider: EmbeddingProviderName;
	apiKey: string;
	model: string;
	inputs: string[];
	taskType?: EmbeddingTaskType;
}

function extractGoogleEmbeddings(response: unknown): number[][] {
	const raw = response as {
		embeddings?: Array<{ values?: number[] } | number[]>;
		embedding?: { values?: number[] } | number[];
	};

	const embeddingsList = Array.isArray(raw?.embeddings)
		? raw.embeddings
		: raw?.embedding
			? [raw.embedding]
			: [];

	return embeddingsList
		.map((entry) => {
			if (Array.isArray(entry)) {
				return entry;
			}
			if (entry && Array.isArray(entry.values)) {
				return entry.values;
			}
			return [];
		})
		.filter((values) => values.length > 0);
}

function extractOpenRouterEmbeddings(response: unknown): number[][] {
	const raw = response as { data?: Array<{ embedding?: number[] }> };
	const data = Array.isArray(raw?.data) ? raw.data : [];
	return data
		.map((entry) => (Array.isArray(entry.embedding) ? entry.embedding : []))
		.filter((values) => values.length > 0);
}

async function generateEmbeddingsOnce(
	request: EmbeddingRequest,
): Promise<number[][]> {
	const { provider, apiKey, model, inputs, taskType } = request;

	if (inputs.length === 0) {
		return [];
	}

	if (provider === "google") {
		const ai = new GoogleGenAI({ apiKey });
		const response = await ai.models.embedContent({
			model,
			contents: inputs,
			config: taskType ? { taskType } : undefined,
		});
		return extractGoogleEmbeddings(response);
	}

	if (provider === "openrouter") {
		const openRouter = new OpenRouter({ apiKey });
		const response = await openRouter.embeddings.generate({
			model,
			input: inputs,
		});
		return extractOpenRouterEmbeddings(response);
	}

	throw new Error(`Unsupported embedding provider: ${provider}`);
}

export async function generateEmbeddings(
	request: EmbeddingRequest,
): Promise<number[][]> {
	try {
		const embeddings = await generateEmbeddingsOnce(request);
		if (embeddings.length !== request.inputs.length) {
			throw new Error(
				`Embedding count mismatch: expected ${request.inputs.length}, got ${embeddings.length}`,
			);
		}
		return embeddings;
	} catch (error) {
		log.error(
			`Failed to generate embeddings for provider ${request.provider} model ${request.model}`,
			error,
		);
		throw error;
	}
}

export async function generateEmbeddingsBatched(
	request: EmbeddingRequest & { batchSize?: number },
): Promise<number[][]> {
	const { batchSize = 16, inputs } = request;
	if (inputs.length === 0) {
		return [];
	}

	const results: number[][] = [];
	for (let i = 0; i < inputs.length; i += batchSize) {
		const batch = inputs.slice(i, i + batchSize);
		const batchEmbeddings = await generateEmbeddings({
			...request,
			inputs: batch,
		});
		results.push(...batchEmbeddings);
	}

	return results;
}
