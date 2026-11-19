import { ApiError, GoogleGenAI } from "@google/genai";
import { log } from "../../utils/misc/logger";
import { MODEL_LOOKUP_TIMEOUT_MS, reportModelLookupFailure } from "@/utils/provider/modelCatalogLookup";

export interface VertexConfig {
  projectId: string;
  location: string;
}

const COMPOSITE_KEY_SEPARATOR = "::";

// The SDK interpolates location into the request hostname and the project into its path, both beside the host's ADC token, so anything beyond a plain label redirects or re-scopes that token.
const VERTEX_SEGMENT_PATTERN = /^[a-z0-9-]+$/i;

export const VERTEX_OWNER_NOT_ALLOWED_CODE = "vertex_owner_not_allowed";
export const VERTEX_CONFIG_ERROR_CODE = "vertex_config_error";

// Unset VERTEX_ALLOWED_OWNERS admits everyone, whereas an empty string denies all owners so clearing the list cannot
// expose host ADC credentials.
export function isVertexOwnerAllowed(ownerDiscordId: string | undefined): boolean {
  const configured = process.env.VERTEX_ALLOWED_OWNERS;
  if (configured === undefined) return true;
  if (!ownerDiscordId) return false;
  return configured.split(",").some((entry) => entry.trim() === ownerDiscordId);
}

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

  if (!VERTEX_SEGMENT_PATTERN.test(projectId)) {
    throw new Error(
      `Vertex composite key has an invalid project ID. Use the Google Cloud project ID or number, such as "my-project".`,
    );
  }

  if (!VERTEX_SEGMENT_PATTERN.test(location)) {
    throw new Error(
      `Vertex composite key has an invalid location. Use a Google Cloud location such as "global" or "us-central1".`,
    );
  }

  return { projectId, location };
}

class VertexClient extends GoogleGenAI {
  getAuthHeaders(): Promise<Headers> {
    return this.apiClient.getAuthHeaders();
  }
}

// A codename with a slash maps to a partner publisher route that Vertex answers with an HTML 404
// even for real partner models, so only its structured publisher-model 404 means the model is absent.
const VERTEX_PUBLISHER_MODEL_NOT_FOUND = /Publisher Model `[^`]+` is not found/;

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
