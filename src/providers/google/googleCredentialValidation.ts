import type { GoogleGenAI } from "@google/genai";

/**
 * Validate access to a Google Gen AI endpoint without invoking a generative model.
 *
 * The SDK fetches the first page while constructing the pager, so awaiting this
 * call exercises API-key or ADC authentication, project/location configuration,
 * and endpoint access without coupling setup to a catalog model's lifecycle.
 *
 * @param client - Configured Gemini API or Vertex AI client
 */
export async function validateGoogleModelsEndpoint(client: Pick<GoogleGenAI, "models">): Promise<void> {
  await client.models.list({
    config: {
      pageSize: 1,
      queryBase: true,
    },
  });
}

// ModelGardenService.ListPublisherModels rejects Vertex AI Express API keys with 401, so Express validates via countTokens instead.
export async function validateVertexExpressEndpoint(client: Pick<GoogleGenAI, "models">, model: string): Promise<void> {
  await client.models.countTokens({
    model,
    contents: "test",
  });
}
