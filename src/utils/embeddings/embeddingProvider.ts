import type { EmbeddingRequest } from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { resolveEmbeddingsCapability } from "@/utils/provider/providerCapabilityResolver";

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

// Process-lifetime set keyed as provider:model because models like Gemini silently embed only the first input instead
// of erroring on batches.
const singleInputEmbeddingModels = new Set<string>();

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

  if (inputs.length > 1 && singleInputEmbeddingModels.has(modelKey)) {
    return await runSequentially();
  }

  const embeddings = await embed(inputs);
  if (embeddings.length === inputs.length) {
    return embeddings;
  }

  // A short count means the model dropped batch items, so cache it and retry sequentially instead of failing.
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

async function generateEmbeddings(request: EmbeddingRequest): Promise<number[][]> {
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
