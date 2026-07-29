import type { EmbeddingRequest } from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { resolveEmbeddingsCapability } from "@/utils/provider/providerCapabilityResolver";

export type EmbeddingProviderName = string;
export type {
  EmbeddingTaskType,
  EmbeddingRequest,
} from "@/types/provider/featureInterfaces";

export async function providerSupportsEmbeddingTaskType(providerName: string): Promise<boolean> {
  const capability = await resolveEmbeddingsCapability(providerName);
  return capability?.supportsEmbeddingTaskType() ?? false;
}

async function generateEmbeddingsOnce(request: EmbeddingRequest): Promise<number[][]> {
  if (request.inputs.length === 0) {
    return [];
  }

  const capability = await resolveEmbeddingsCapability(request.provider);
  if (!capability) {
    throw new Error(`Unsupported embedding provider: ${request.provider}`);
  }

  return await capability.generateEmbeddings(request);
}

/**
 * Models observed to return a single embedding regardless of how many inputs were sent.
 *
 * Some embedding models (notably the newer Gemini embedding family) accept only one content
 * per request and silently embed just the first, rather than erroring. Once a model is seen
 * behaving this way, later batches for that model go straight to per-input requests instead
 * of paying for a doomed batch call first. Keyed `provider:model`; process-lifetime only.
 */
const singleInputEmbeddingModels = new Set<string>();

/**
 * Runs `embed` for the whole batch, falling back to one call per input when the model
 * returns fewer embeddings than it was given.
 *
 * Kept free of provider resolution so the retry policy is testable on its own; callers
 * supply whatever performs the actual request.
 *
 * @param inputs - Texts to embed.
 * @param modelKey - `provider:model`, used to remember non-batching models for the process.
 * @param embed - Performs one request for the given texts.
 * @returns One embedding per input, in order.
 * @throws When a single-input request returns anything other than one embedding.
 */
export async function embedWithBatchFallback(
  inputs: string[],
  modelKey: string,
  embed: (batch: string[]) => Promise<number[][]>,
): Promise<number[][]> {
  const runSequentially = async (): Promise<number[][]> => {
    const embeddings: number[][] = [];
    for (const input of inputs) {
      const single = await embed([input]);
      if (single.length !== 1) {
        throw new Error(`Embedding count mismatch: expected 1, got ${single.length}`);
      }
      embeddings.push(single[0]);
    }
    return embeddings;
  };

  // Skip the batch attempt entirely for a model already known not to honour batching.
  if (inputs.length > 1 && singleInputEmbeddingModels.has(modelKey)) {
    return await runSequentially();
  }

  const embeddings = await embed(inputs);
  if (embeddings.length === inputs.length) {
    return embeddings;
  }

  // A short count on a multi-input request means the model ignored the batch rather than
  //    failing, so retry one input at a time instead of surfacing a mismatch the caller
  //    cannot act on. Remember the model so later batches skip straight to step 1.
  if (inputs.length > 1) {
    log.warn(
      `Embedding model ${modelKey} returned ${embeddings.length} embeddings for ${inputs.length} inputs; ` +
        `retrying one input at a time.`,
    );
    singleInputEmbeddingModels.add(modelKey);
    return await runSequentially();
  }

  throw new Error(`Embedding count mismatch: expected ${inputs.length}, got ${embeddings.length}`);
}

export async function generateEmbeddings(request: EmbeddingRequest): Promise<number[][]> {
  try {
    return await embedWithBatchFallback(
      request.inputs,
      `${request.provider}:${request.model}`,
      async (batch) => await generateEmbeddingsOnce({ ...request, inputs: batch }),
    );
  } catch (error) {
    log.error(`Failed to generate embeddings for provider ${request.provider} model ${request.model}`, error);
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
