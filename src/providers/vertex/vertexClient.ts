/**
 * Vertex AI client construction and composite-key parsing
 *
 * The stored "API key" for the Vertex provider is actually a composite config:
 *   {project_id}::{location}
 * Example: "my-gcp-project::us-central1"
 *
 * Real authentication comes from Application Default Credentials (ADC) on the host:
 *   - Service account on the machine/container
 *   - GOOGLE_APPLICATION_CREDENTIALS env var
 *   - `gcloud auth application-default login`
 *
 * This module centralises parsing, validation, and GoogleGenAI client construction
 * so streaming, validation, and any future v2 helpers share the same logic.
 */

import { ApiError, GoogleGenAI } from "@google/genai";
import { log } from "../../utils/misc/logger";
import { MODEL_LOOKUP_TIMEOUT_MS, reportModelLookupFailure } from "@/utils/provider/modelCatalogLookup";

export interface VertexConfig {
  /** GCP project ID */
  projectId: string;
  /** GCP region / location (e.g. "us-central1") */
  location: string;
}

const COMPOSITE_KEY_SEPARATOR = "::";

// The SDK interpolates location into the request hostname and attaches the host's ADC token, so anything beyond a DNS label redirects that token.
const VERTEX_LOCATION_PATTERN = /^[a-z0-9-]+$/i;

/**
 * Parse the composite key string stored as the "API key" for Vertex.
 *
 * Expected format: `{project_id}::{location}`
 *
 * @param compositeKey - The raw composite key from the database
 * @throws Error if the format is invalid
 */
export function parseVertexCompositeKey(compositeKey: string): VertexConfig {
  if (!compositeKey || typeof compositeKey !== "string") {
    throw new Error("Vertex composite key is empty. Expected format: {project_id}::{location}");
  }

  const parts = compositeKey.split(COMPOSITE_KEY_SEPARATOR);

  if (parts.length !== 2) {
    throw new Error(
      `Invalid Vertex composite key format. Expected exactly one "${COMPOSITE_KEY_SEPARATOR}" separator. Got: "${compositeKey}"`,
    );
  }

  const [projectId, location] = parts.map((p) => p.trim());

  if (!projectId) {
    throw new Error(`Vertex composite key has an empty project ID. Expected format: {project_id}::{location}`);
  }

  if (!location) {
    throw new Error(`Vertex composite key has an empty location. Expected format: {project_id}::{location}`);
  }

  if (!VERTEX_LOCATION_PATTERN.test(location)) {
    throw new Error(
      `Vertex composite key has an invalid location. Use a Google Cloud location such as "global" or "us-central1".`,
    );
  }

  return { projectId, location };
}

/**
 * Construct a GoogleGenAI client configured for Vertex AI.
 *
 * Uses ADC (Application Default Credentials) rather than an API key.
 *
 * @returns GoogleGenAI client ready for Vertex AI calls
 */
class VertexClient extends GoogleGenAI {
  getAuthHeaders(): Promise<Headers> {
    return this.apiClient.getAuthHeaders();
  }
}

// A codename with a slash maps to a partner publisher route that Vertex answers with an HTML 404
// even for real partner models, so only its structured publisher-model 404 means the model is absent.
const VERTEX_PUBLISHER_MODEL_NOT_FOUND = /Publisher Model `[^`]+` is not found/;

/** Looks a text model up for registration on either Vertex provider; see `LLMProvider.checkTextModel`. */
export async function checkVertexTextModel(
  provider: "vertex" | "vertexexpress",
  client: GoogleGenAI,
  codename: string,
  credential: string,
): Promise<boolean | null> {
  try {
    await client.models.get({ model: codename, config: { httpOptions: { timeout: MODEL_LOOKUP_TIMEOUT_MS } } });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && VERTEX_PUBLISHER_MODEL_NOT_FOUND.test(error.message)) {
      return false;
    }
    await reportModelLookupFailure(provider, error, credential);
    return null;
  }
}

export function createVertexClient(config: VertexConfig): VertexClient {
  log.info(`Creating Vertex AI client for project "${config.projectId}" in "${config.location}"`);

  return new VertexClient({
    vertexai: true,
    project: config.projectId,
    location: config.location,
  });
}
