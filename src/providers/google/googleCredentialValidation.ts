import type { GoogleGenAI } from "@google/genai";

// Awaiting models.list without iterating works because the SDK fetches the first page during pager construction,
// validating auth without a model call.
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
