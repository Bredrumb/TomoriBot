import type { DiffusionModelRow, EmbeddingModelRow, LlmRow, VideoGenerationModelRow } from "@/types/db/schema";
import { getOrFetchOpenRouterCapabilities } from "@/utils/cache/openrouterCapabilityCache";
import { sql } from "@/utils/db/client";
import {
  loadDiffusionModelByProviderAndCodename,
  loadEmbeddingModelByProviderAndCodename,
  loadLlmByProviderAndCodename,
  loadScopedOpenRouterDiffusionModels,
  loadScopedOpenRouterEmbeddingModels,
  loadScopedOpenRouterModels,
  loadScopedOpenRouterVideoGenerationModels,
  loadVideoGenerationModelByProviderAndCodename,
} from "@/utils/db/repositories";
import {
  deleteOpenRouterEmbeddingModelRegistration,
  deleteOpenRouterImageModelRegistration,
  deleteOpenRouterModelRegistration,
  deleteOpenRouterVideoModelRegistration,
  upsertOpenRouterEmbeddingModelRegistration,
  upsertOpenRouterImageModelRegistration,
  upsertOpenRouterModelRegistration,
  upsertOpenRouterVideoModelRegistration,
} from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { isOpenRouterGeminiModelCodename } from "@/utils/provider/openrouterModelCapabilities";

export type OpenRouterModelRegistryScope =
  | {
      kind: "server";
      ownerId: number;
    }
  | {
      kind: "personal";
      ownerId: number;
    };

export type OpenRouterModelCapability = "text" | "embedding" | "image" | "video";

export interface RegisteredOpenRouterModelEntry {
  capability: OpenRouterModelCapability;
  codename: string;
  description: string | null;
  modelId: number;
}

export type RegisterOpenRouterModelResult =
  | {
      status: "registered";
      model: RegisteredOpenRouterModelEntry;
    }
  | {
      status: "already_registered";
      model: RegisteredOpenRouterModelEntry;
    }
  | {
      status: "already_available";
      model: RegisteredOpenRouterModelEntry;
    }
  | {
      status: "invalid_model";
    };

export type RemoveOpenRouterModelResult =
  | {
      status: "removed";
      stillReferenced: boolean;
      model: RegisteredOpenRouterModelEntry;
    }
  | {
      status: "not_found";
    }
  | {
      status: "already_available";
    };

function normalizeModelCodename(modelName: string): string {
  return modelName.trim().toLowerCase();
}

function deriveModelFamily(modelCodename: string): string {
  return modelCodename.split("/").pop() ?? modelCodename;
}

function buildRegisteredEntryFromLlm(llm: LlmRow): RegisteredOpenRouterModelEntry | null {
  if (!llm.llm_id) {
    return null;
  }

  return {
    capability: "text",
    codename: llm.llm_codename,
    description: llm.llm_description ?? llm.ja_description ?? llm.llm_codename,
    modelId: llm.llm_id,
  };
}

function buildRegisteredEntryFromEmbeddingModel(model: EmbeddingModelRow): RegisteredOpenRouterModelEntry | null {
  if (!model.embedding_model_id) {
    return null;
  }

  return {
    capability: "embedding",
    codename: model.codename,
    description: model.model_description ?? model.ja_description ?? model.codename,
    modelId: model.embedding_model_id,
  };
}

function buildRegisteredEntryFromDiffusionModel(model: DiffusionModelRow): RegisteredOpenRouterModelEntry | null {
  if (!model.diffusion_model_id) {
    return null;
  }

  return {
    capability: "image",
    codename: model.codename,
    description: model.model_description ?? model.ja_description ?? model.codename,
    modelId: model.diffusion_model_id,
  };
}

function buildRegisteredEntryFromVideoModel(model: VideoGenerationModelRow): RegisteredOpenRouterModelEntry | null {
  if (!model.video_model_id) {
    return null;
  }

  return {
    capability: "video",
    codename: model.codename,
    description: model.model_description ?? model.ja_description ?? model.codename,
    modelId: model.video_model_id,
  };
}

async function modelExistsInOpenRouterCatalog(modelCodename: string): Promise<boolean> {
  return Boolean(await getOrFetchOpenRouterCapabilities(modelCodename));
}

async function upsertScopedOpenRouterLlm(modelCodename: string): Promise<LlmRow | null> {
  const capabilities = await getOrFetchOpenRouterCapabilities(modelCodename);
  if (!capabilities) {
    return null;
  }

  const rows = await sql`
		INSERT INTO llms (
			llm_provider,
			llm_codename,
			is_scoped_registration,
			is_smartest,
			is_default,
			is_reasoning,
			is_deprecated,
			is_free,
			has_tools,
			sees_images,
			sees_videos,
			sees_youtube,
			is_uncensored,
			supports_structoutput,
			llm_description,
			ja_description
		) VALUES (
			'openrouter',
			${modelCodename},
			true,
			false,
			false,
			false,
			false,
			false,
			${capabilities.hasTools},
			${capabilities.seesImages},
			${capabilities.seesVideos},
			${isOpenRouterGeminiModelCodename(modelCodename)},
			false,
			${capabilities.supportsStructuredOutput},
			${modelCodename},
			${modelCodename}
		)
		ON CONFLICT (llm_provider, llm_codename) DO UPDATE SET
			is_scoped_registration = true,
			is_deprecated = false,
			has_tools = EXCLUDED.has_tools,
			sees_images = EXCLUDED.sees_images,
			sees_videos = EXCLUDED.sees_videos,
			sees_youtube = EXCLUDED.sees_youtube,
			supports_structoutput = EXCLUDED.supports_structoutput,
			llm_description = EXCLUDED.llm_description,
			ja_description = EXCLUDED.ja_description,
			updated_at = CURRENT_TIMESTAMP
		RETURNING llm_id
	`;

  const llmId = Number(rows[0]?.llm_id);
  return Number.isInteger(llmId) ? await loadLlmByProviderAndCodename("openrouter", modelCodename) : null;
}

async function upsertScopedOpenRouterEmbeddingModel(modelCodename: string): Promise<EmbeddingModelRow | null> {
  const rows = await sql`
		INSERT INTO embedding_models (
			provider,
			codename,
			model_family,
			is_scoped_registration,
			model_description,
			ja_description,
			is_default,
			is_deprecated
		) VALUES (
			'openrouter',
			${modelCodename},
			${deriveModelFamily(modelCodename)},
			true,
			${modelCodename},
			${modelCodename},
			false,
			false
		)
		ON CONFLICT (provider, codename) DO UPDATE SET
			model_family = EXCLUDED.model_family,
			is_scoped_registration = true,
			model_description = EXCLUDED.model_description,
			ja_description = EXCLUDED.ja_description,
			is_default = false,
			is_deprecated = false,
			updated_at = CURRENT_TIMESTAMP
		RETURNING embedding_model_id
	`;

  const embeddingModelId = Number(rows[0]?.embedding_model_id);
  return Number.isInteger(embeddingModelId)
    ? await loadEmbeddingModelByProviderAndCodename("openrouter", modelCodename)
    : null;
}

async function upsertScopedOpenRouterDiffusionModel(modelCodename: string): Promise<DiffusionModelRow | null> {
  const rows = await sql`
		INSERT INTO image_diffusion_models (
			provider,
			codename,
			is_scoped_registration,
			model_description,
			ja_description,
			is_default,
			is_deprecated,
			is_free,
			is_uncensored
		) VALUES (
			'openrouter',
			${modelCodename},
			true,
			${modelCodename},
			${modelCodename},
			false,
			false,
			false,
			false
		)
		ON CONFLICT (provider, codename) DO UPDATE SET
			is_scoped_registration = true,
			model_description = EXCLUDED.model_description,
			ja_description = EXCLUDED.ja_description,
			is_default = false,
			is_deprecated = false,
			is_free = EXCLUDED.is_free,
			is_uncensored = EXCLUDED.is_uncensored,
			updated_at = CURRENT_TIMESTAMP
		RETURNING diffusion_model_id
	`;

  const diffusionModelId = Number(rows[0]?.diffusion_model_id);
  return Number.isInteger(diffusionModelId)
    ? await loadDiffusionModelByProviderAndCodename("openrouter", modelCodename)
    : null;
}

async function upsertScopedOpenRouterVideoModel(modelCodename: string): Promise<VideoGenerationModelRow | null> {
  const rows = await sql`
		INSERT INTO video_generation_models (
			provider,
			codename,
			is_scoped_registration,
			model_description,
			ja_description,
			is_default,
			is_deprecated,
			is_free
		) VALUES (
			'openrouter',
			${modelCodename},
			true,
			${modelCodename},
			${modelCodename},
			false,
			false,
			false
		)
		ON CONFLICT (provider, codename) DO UPDATE SET
			is_scoped_registration = true,
			model_description = EXCLUDED.model_description,
			ja_description = EXCLUDED.ja_description,
			is_default = false,
			is_deprecated = false,
			is_free = EXCLUDED.is_free,
			updated_at = CURRENT_TIMESTAMP
		RETURNING video_model_id
	`;

  const videoModelId = Number(rows[0]?.video_model_id);
  return Number.isInteger(videoModelId)
    ? await loadVideoGenerationModelByProviderAndCodename("openrouter", modelCodename)
    : null;
}

async function loadRegisteredOpenRouterEntriesForCapability(
  scope: OpenRouterModelRegistryScope,
  capability: OpenRouterModelCapability,
): Promise<RegisteredOpenRouterModelEntry[]> {
  switch (capability) {
    case "text":
      return (await loadScopedOpenRouterModels(scope, true))
        .filter((model) => model.is_scoped_registration)
        .map(buildRegisteredEntryFromLlm)
        .filter((model): model is RegisteredOpenRouterModelEntry => model !== null);
    case "embedding":
      return (await loadScopedOpenRouterEmbeddingModels(scope, true))
        .filter((model) => model.is_scoped_registration)
        .map(buildRegisteredEntryFromEmbeddingModel)
        .filter((model): model is RegisteredOpenRouterModelEntry => model !== null);
    case "image":
      return (await loadScopedOpenRouterDiffusionModels(scope, true))
        .filter((model) => model.is_scoped_registration)
        .map(buildRegisteredEntryFromDiffusionModel)
        .filter((model): model is RegisteredOpenRouterModelEntry => model !== null);
    case "video":
      return (await loadScopedOpenRouterVideoGenerationModels(scope, true))
        .filter((model) => model.is_scoped_registration)
        .map(buildRegisteredEntryFromVideoModel)
        .filter((model): model is RegisteredOpenRouterModelEntry => model !== null);
  }
}

async function loadOpenRouterBuiltInEntry(
  capability: OpenRouterModelCapability,
  modelCodename: string,
): Promise<RegisteredOpenRouterModelEntry | null> {
  switch (capability) {
    case "text": {
      const llm = await loadLlmByProviderAndCodename("openrouter", modelCodename);
      return llm && !llm.is_scoped_registration ? buildRegisteredEntryFromLlm(llm) : null;
    }
    case "embedding": {
      const model = await loadEmbeddingModelByProviderAndCodename("openrouter", modelCodename);
      return model && !model.is_scoped_registration ? buildRegisteredEntryFromEmbeddingModel(model) : null;
    }
    case "image": {
      const model = await loadDiffusionModelByProviderAndCodename("openrouter", modelCodename);
      return model && !model.is_scoped_registration ? buildRegisteredEntryFromDiffusionModel(model) : null;
    }
    case "video": {
      const model = await loadVideoGenerationModelByProviderAndCodename("openrouter", modelCodename);
      return model && !model.is_scoped_registration ? buildRegisteredEntryFromVideoModel(model) : null;
    }
  }
}

async function isTextModelStillReferenced(llmId: number): Promise<boolean> {
  const [row] = await sql<Array<{ in_use: boolean }>>`
		SELECT EXISTS (
		  SELECT 1
		  FROM tomori_configs
		  WHERE llm_id = ${llmId}
		     OR vision_llm_id = ${llmId}
		     OR COALESCE(fallback_llm_ids, '[]'::JSONB) @> jsonb_build_array(${llmId})
		     OR EXISTS (
		        SELECT 1
		        FROM jsonb_array_elements(
		          CASE
		            WHEN jsonb_typeof(COALESCE(tomori_configs.fallback_model_refs, '[]'::JSONB)) = 'array'
		              THEN COALESCE(tomori_configs.fallback_model_refs, '[]'::JSONB)
		            ELSE '[]'::JSONB
		          END
		        ) AS ref
		        WHERE ref ->> 'type' = 'llm'
		          AND ref ->> 'id' = ${String(llmId)}
		     )
		  UNION ALL
		  SELECT 1
		  FROM persona_configs
		  WHERE llm_id = ${llmId}
		  UNION ALL
		  SELECT 1
		  FROM channel_llm_overrides
		  WHERE llm_id = ${llmId}
		  UNION ALL
		  SELECT 1
		  FROM saved_provider_configs
		  WHERE llm_id = ${llmId}
		     OR vision_llm_id = ${llmId}
		     OR COALESCE(fallback_llm_ids, '[]'::JSONB) @> jsonb_build_array(${llmId})
		     OR EXISTS (
		        SELECT 1
		        FROM jsonb_array_elements(
		          CASE
		            WHEN jsonb_typeof(COALESCE(saved_provider_configs.fallback_model_refs, '[]'::JSONB)) = 'array'
		              THEN COALESCE(saved_provider_configs.fallback_model_refs, '[]'::JSONB)
		            ELSE '[]'::JSONB
		          END
		        ) AS ref
		        WHERE ref ->> 'type' = 'llm'
		          AND ref ->> 'id' = ${String(llmId)}
		     )
		  UNION ALL
		  SELECT 1
		  FROM user_saved_provider_configs
		  WHERE llm_id = ${llmId}
		     OR vision_llm_id = ${llmId}
		     OR COALESCE(fallback_llm_ids, '[]'::JSONB) @> jsonb_build_array(${llmId})
		     OR EXISTS (
		        SELECT 1
		        FROM jsonb_array_elements(
		          CASE
		            WHEN jsonb_typeof(COALESCE(user_saved_provider_configs.fallback_model_refs, '[]'::JSONB)) = 'array'
		              THEN COALESCE(user_saved_provider_configs.fallback_model_refs, '[]'::JSONB)
		            ELSE '[]'::JSONB
		          END
		        ) AS ref
		        WHERE ref ->> 'type' = 'llm'
		          AND ref ->> 'id' = ${String(llmId)}
		     )
		) AS in_use
	`;

  return Boolean(row?.in_use);
}

async function isEmbeddingModelStillReferenced(embeddingModelId: number): Promise<boolean> {
  const [row] = await sql<Array<{ in_use: boolean }>>`
		SELECT EXISTS (
		  SELECT 1
		  FROM tomori_configs
		  WHERE embedding_model_id = ${embeddingModelId}
		  UNION ALL
		  SELECT 1
		  FROM saved_provider_configs
		  WHERE embedding_model_id = ${embeddingModelId}
		  UNION ALL
		  SELECT 1
		  FROM user_saved_provider_configs
		  WHERE embedding_model_id = ${embeddingModelId}
		) AS in_use
	`;

  return Boolean(row?.in_use);
}

async function isDiffusionModelStillReferenced(diffusionModelId: number): Promise<boolean> {
  const [row] = await sql<Array<{ in_use: boolean }>>`
		SELECT EXISTS (
		  SELECT 1
		  FROM tomori_configs
		  WHERE diffusion_model_id = ${diffusionModelId}
		     OR nai_diffusion_model_id = ${diffusionModelId}
		  UNION ALL
		  SELECT 1
		  FROM saved_provider_configs
		  WHERE diffusion_model_id = ${diffusionModelId}
		     OR nai_diffusion_model_id = ${diffusionModelId}
		  UNION ALL
		  SELECT 1
		  FROM user_saved_provider_configs
		  WHERE diffusion_model_id = ${diffusionModelId}
		     OR nai_diffusion_model_id = ${diffusionModelId}
		) AS in_use
	`;

  return Boolean(row?.in_use);
}

async function isVideoModelStillReferenced(videoModelId: number): Promise<boolean> {
  const [row] = await sql<Array<{ in_use: boolean }>>`
		SELECT EXISTS (
		  SELECT 1
		  FROM tomori_configs
		  WHERE video_model_id = ${videoModelId}
		  UNION ALL
		  SELECT 1
		  FROM saved_provider_configs
		  WHERE video_model_id = ${videoModelId}
		  UNION ALL
		  SELECT 1
		  FROM user_saved_provider_configs
		  WHERE video_model_id = ${videoModelId}
		) AS in_use
	`;

  return Boolean(row?.in_use);
}

export async function registerOpenRouterModelForScope(
  scope: OpenRouterModelRegistryScope,
  capability: OpenRouterModelCapability,
  modelName: string,
): Promise<RegisterOpenRouterModelResult> {
  const normalizedModelName = normalizeModelCodename(modelName);
  if (!normalizedModelName) {
    return { status: "invalid_model" };
  }

  const builtInModel = await loadOpenRouterBuiltInEntry(capability, normalizedModelName);
  if (builtInModel) {
    return {
      status: "already_available",
      model: builtInModel,
    };
  }

  const visibleModels = await loadRegisteredOpenRouterEntriesForCapability(scope, capability);
  const alreadyRegistered = visibleModels.find((model) => model.codename === normalizedModelName);
  if (alreadyRegistered) {
    return {
      status: "already_registered",
      model: alreadyRegistered,
    };
  }

  switch (capability) {
    case "text": {
      // Only text models appear in OpenRouter's LLM catalog — validate before upserting
      if (!(await modelExistsInOpenRouterCatalog(normalizedModelName))) {
        return { status: "invalid_model" };
      }

      const llm = await upsertScopedOpenRouterLlm(normalizedModelName);
      const entry = llm ? buildRegisteredEntryFromLlm(llm) : null;
      if (!entry) {
        return { status: "invalid_model" };
      }

      const registration =
        scope.kind === "server"
          ? await upsertOpenRouterModelRegistration({
              serverId: scope.ownerId,
              llmId: entry.modelId,
            })
          : await upsertOpenRouterModelRegistration({
              userId: scope.ownerId,
              llmId: entry.modelId,
            });

      if (!registration) {
        throw new Error(`Failed to register scoped OpenRouter text model ${normalizedModelName}`);
      }

      return {
        status: "registered",
        model: entry,
      };
    }
    case "embedding": {
      const model = await upsertScopedOpenRouterEmbeddingModel(normalizedModelName);
      const entry = model ? buildRegisteredEntryFromEmbeddingModel(model) : null;
      if (!entry) {
        return { status: "invalid_model" };
      }

      const registration =
        scope.kind === "server"
          ? await upsertOpenRouterEmbeddingModelRegistration({
              serverId: scope.ownerId,
              embeddingModelId: entry.modelId,
            })
          : await upsertOpenRouterEmbeddingModelRegistration({
              userId: scope.ownerId,
              embeddingModelId: entry.modelId,
            });

      if (!registration) {
        throw new Error(`Failed to register scoped OpenRouter embedding model ${normalizedModelName}`);
      }

      return {
        status: "registered",
        model: entry,
      };
    }
    case "image": {
      const model = await upsertScopedOpenRouterDiffusionModel(normalizedModelName);
      const entry = model ? buildRegisteredEntryFromDiffusionModel(model) : null;
      if (!entry) {
        return { status: "invalid_model" };
      }

      const registration =
        scope.kind === "server"
          ? await upsertOpenRouterImageModelRegistration({
              serverId: scope.ownerId,
              diffusionModelId: entry.modelId,
            })
          : await upsertOpenRouterImageModelRegistration({
              userId: scope.ownerId,
              diffusionModelId: entry.modelId,
            });

      if (!registration) {
        throw new Error(`Failed to register scoped OpenRouter image model ${normalizedModelName}`);
      }

      return {
        status: "registered",
        model: entry,
      };
    }
    case "video": {
      const model = await upsertScopedOpenRouterVideoModel(normalizedModelName);
      const entry = model ? buildRegisteredEntryFromVideoModel(model) : null;
      if (!entry) {
        return { status: "invalid_model" };
      }

      const registration =
        scope.kind === "server"
          ? await upsertOpenRouterVideoModelRegistration({
              serverId: scope.ownerId,
              videoModelId: entry.modelId,
            })
          : await upsertOpenRouterVideoModelRegistration({
              userId: scope.ownerId,
              videoModelId: entry.modelId,
            });

      if (!registration) {
        throw new Error(`Failed to register scoped OpenRouter video model ${normalizedModelName}`);
      }

      return {
        status: "registered",
        model: entry,
      };
    }
  }
}

export async function removeOpenRouterModelForScope(
  scope: OpenRouterModelRegistryScope,
  capability: OpenRouterModelCapability,
  modelName: string,
): Promise<RemoveOpenRouterModelResult> {
  const normalizedModelName = normalizeModelCodename(modelName);
  if (!normalizedModelName) {
    return { status: "not_found" };
  }

  switch (capability) {
    case "text": {
      const model = await loadLlmByProviderAndCodename("openrouter", normalizedModelName);
      const entry = model ? buildRegisteredEntryFromLlm(model) : null;
      if (!model || !entry) {
        return { status: "not_found" };
      }
      if (!model.is_scoped_registration) {
        return { status: "already_available" };
      }

      const deleted =
        scope.kind === "server"
          ? await deleteOpenRouterModelRegistration({
              serverId: scope.ownerId,
              llmId: entry.modelId,
            })
          : await deleteOpenRouterModelRegistration({
              userId: scope.ownerId,
              llmId: entry.modelId,
            });

      if (!deleted) {
        return { status: "not_found" };
      }

      const [remainingRegistrationCountRow] = await sql<Array<{ count: string | number }>>`
				SELECT COUNT(*) AS count
				FROM openrouter_model_registrations
				WHERE llm_id = ${entry.modelId}
			`;
      const remainingRegistrationCount = Number(remainingRegistrationCountRow?.count ?? 0);
      const stillReferenced = await isTextModelStillReferenced(entry.modelId);

      if (remainingRegistrationCount === 0 && !stillReferenced) {
        await sql`
					DELETE FROM llms
					WHERE llm_id = ${entry.modelId}
					  AND llm_provider = 'openrouter'
					  AND COALESCE(is_scoped_registration, false) = true
				`;
      }

      return {
        status: "removed",
        stillReferenced,
        model: entry,
      };
    }
    case "embedding": {
      const model = await loadEmbeddingModelByProviderAndCodename("openrouter", normalizedModelName);
      const entry = model ? buildRegisteredEntryFromEmbeddingModel(model) : null;
      if (!model || !entry) {
        return { status: "not_found" };
      }
      if (!model.is_scoped_registration) {
        return { status: "already_available" };
      }

      const deleted =
        scope.kind === "server"
          ? await deleteOpenRouterEmbeddingModelRegistration({
              serverId: scope.ownerId,
              embeddingModelId: entry.modelId,
            })
          : await deleteOpenRouterEmbeddingModelRegistration({
              userId: scope.ownerId,
              embeddingModelId: entry.modelId,
            });

      if (!deleted) {
        return { status: "not_found" };
      }

      const [remainingRegistrationCountRow] = await sql<Array<{ count: string | number }>>`
				SELECT COUNT(*) AS count
				FROM openrouter_embedding_model_registrations
				WHERE embedding_model_id = ${entry.modelId}
			`;
      const remainingRegistrationCount = Number(remainingRegistrationCountRow?.count ?? 0);
      const stillReferenced = await isEmbeddingModelStillReferenced(entry.modelId);

      if (remainingRegistrationCount === 0 && !stillReferenced) {
        await sql`
					DELETE FROM embedding_models
					WHERE embedding_model_id = ${entry.modelId}
					  AND provider = 'openrouter'
					  AND COALESCE(is_scoped_registration, false) = true
				`;
      }

      return {
        status: "removed",
        stillReferenced,
        model: entry,
      };
    }
    case "image": {
      const model = await loadDiffusionModelByProviderAndCodename("openrouter", normalizedModelName);
      const entry = model ? buildRegisteredEntryFromDiffusionModel(model) : null;
      if (!model || !entry) {
        return { status: "not_found" };
      }
      if (!model.is_scoped_registration) {
        return { status: "already_available" };
      }

      const deleted =
        scope.kind === "server"
          ? await deleteOpenRouterImageModelRegistration({
              serverId: scope.ownerId,
              diffusionModelId: entry.modelId,
            })
          : await deleteOpenRouterImageModelRegistration({
              userId: scope.ownerId,
              diffusionModelId: entry.modelId,
            });

      if (!deleted) {
        return { status: "not_found" };
      }

      const [remainingRegistrationCountRow] = await sql<Array<{ count: string | number }>>`
				SELECT COUNT(*) AS count
				FROM openrouter_image_model_registrations
				WHERE diffusion_model_id = ${entry.modelId}
			`;
      const remainingRegistrationCount = Number(remainingRegistrationCountRow?.count ?? 0);
      const stillReferenced = await isDiffusionModelStillReferenced(entry.modelId);

      if (remainingRegistrationCount === 0 && !stillReferenced) {
        await sql`
					DELETE FROM image_diffusion_models
					WHERE diffusion_model_id = ${entry.modelId}
					  AND provider = 'openrouter'
					  AND COALESCE(is_scoped_registration, false) = true
				`;
      }

      return {
        status: "removed",
        stillReferenced,
        model: entry,
      };
    }
    case "video": {
      const model = await loadVideoGenerationModelByProviderAndCodename("openrouter", normalizedModelName);
      const entry = model ? buildRegisteredEntryFromVideoModel(model) : null;
      if (!model || !entry) {
        return { status: "not_found" };
      }
      if (!model.is_scoped_registration) {
        return { status: "already_available" };
      }

      const deleted =
        scope.kind === "server"
          ? await deleteOpenRouterVideoModelRegistration({
              serverId: scope.ownerId,
              videoModelId: entry.modelId,
            })
          : await deleteOpenRouterVideoModelRegistration({
              userId: scope.ownerId,
              videoModelId: entry.modelId,
            });

      if (!deleted) {
        return { status: "not_found" };
      }

      const [remainingRegistrationCountRow] = await sql<Array<{ count: string | number }>>`
				SELECT COUNT(*) AS count
				FROM openrouter_video_model_registrations
				WHERE video_model_id = ${entry.modelId}
			`;
      const remainingRegistrationCount = Number(remainingRegistrationCountRow?.count ?? 0);
      const stillReferenced = await isVideoModelStillReferenced(entry.modelId);

      if (remainingRegistrationCount === 0 && !stillReferenced) {
        await sql`
					DELETE FROM video_generation_models
					WHERE video_model_id = ${entry.modelId}
					  AND provider = 'openrouter'
					  AND COALESCE(is_scoped_registration, false) = true
				`;
      }

      return {
        status: "removed",
        stillReferenced,
        model: entry,
      };
    }
  }
}

export async function loadRegisteredOpenRouterModelsForScope(
  scope: OpenRouterModelRegistryScope,
): Promise<RegisteredOpenRouterModelEntry[]> {
  const [textModels, embeddingModels, imageModels, videoModels] = await Promise.all([
    loadRegisteredOpenRouterEntriesForCapability(scope, "text"),
    loadRegisteredOpenRouterEntriesForCapability(scope, "embedding"),
    loadRegisteredOpenRouterEntriesForCapability(scope, "image"),
    loadRegisteredOpenRouterEntriesForCapability(scope, "video"),
  ]);

  const capabilityOrder: Record<OpenRouterModelCapability, number> = {
    text: 0,
    embedding: 1,
    image: 2,
    video: 3,
  };

  return [...textModels, ...embeddingModels, ...imageModels, ...videoModels].sort(
    (a, b) => capabilityOrder[a.capability] - capabilityOrder[b.capability] || a.codename.localeCompare(b.codename),
  );
}

export function formatScopedOpenRouterCommand(scope: OpenRouterModelRegistryScope, action: "add" | "remove"): string {
  return scope.kind === "server" ? `/openrouter model ${action}` : `/personal openrouter-model ${action}`;
}

export async function logOpenRouterRegistryError(context: string, error: unknown): Promise<void> {
  await log.error(context, error as Error);
}
