import { z } from "zod";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";

/** Registration waits on this inside an already deferred panel submit, so a slow catalog only delays the receipt. */
export const MODEL_LOOKUP_TIMEOUT_MS = 5_000;

const openAIModelListSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

/**
 * Records a catalog lookup that could not answer. Registration then proceeds unchecked, so this is
 * never an incident: the model's first request reports a bad codename as a model error anyway.
 */
export async function reportModelLookupFailure(provider: string, error: unknown, apiKey?: string): Promise<void> {
  await reportProviderFailure({
    summary: "Model catalog lookup failed",
    errorType: "ModelCatalogLookupFailed",
    error,
    expected: true,
    dimensions: { provider, operation: "model_lookup" },
    redactValues: apiKey ? [apiKey] : undefined,
  });
}

/**
 * Whether an OpenAI-style `/models` listing includes `modelId`, or null when the listing could not
 * be read. An empty listing also answers null, because it describes the account rather than the catalog.
 */
export async function isListedInOpenAIModelCatalog(params: {
  provider: string;
  url: string;
  modelId: string;
  apiKey?: string;
}): Promise<boolean | null> {
  try {
    const response = await fetch(params.url, {
      headers: params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : undefined,
      signal: AbortSignal.timeout(MODEL_LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) {
      await reportModelLookupFailure(params.provider, new Error(`Model listing returned ${response.status}`));
      return null;
    }
    const listing = openAIModelListSchema.safeParse(await response.json());
    if (!listing.success) {
      await reportModelLookupFailure(params.provider, listing.error);
      return null;
    }
    if (listing.data.data.length === 0) return null;
    return listing.data.data.some((model) => model.id === params.modelId);
  } catch (error) {
    await reportModelLookupFailure(params.provider, error, params.apiKey);
    return null;
  }
}
