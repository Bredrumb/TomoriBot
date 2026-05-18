import type { AssembledServerConfig } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { llmModelRepo } from "@/utils/db/repositories/LlmModelRepository";

export type NaiDiffusionModelSource = "override" | "shared" | "default";

export type ResolvedNaiDiffusionModel = {
  diffusionModelId: number;
  codename: string;
  source: NaiDiffusionModelSource;
};

type NaiDiffusionModelConfig = Pick<AssembledServerConfig, "diffusion_model_id" | "nai_diffusion_model_id">;

export type DiffusionModelFields = {
  diffusion_model_id: number;
  provider: string;
  codename: string;
  model_description: string | null;
  ja_description: string | null;
  is_default: boolean;
  is_deprecated: boolean;
  is_free: boolean;
  is_uncensored: boolean;
};

export async function getDiffusionModelById(diffusionModelId: number): Promise<DiffusionModelFields | null> {
  const model = await llmModelRepo.loadDiffusionModelById(diffusionModelId);
  if (!model || model.diffusion_model_id === undefined) return null;
  return model as DiffusionModelFields;
}

export async function getNovelAiDiffusionModels(): Promise<DiffusionModelFields[]> {
  const models = await llmModelRepo.loadAvailableDiffusionModels("novelai", false);
  if (!models) return [];
  return models
    .filter((m) => m.diffusion_model_id !== undefined)
    .sort((a, b) => {
      if (a.is_default !== b.is_default) {
        return a.is_default ? -1 : 1;
      }
      return a.codename.localeCompare(b.codename);
    }) as DiffusionModelFields[];
}

export async function getDefaultNovelAiDiffusionModel(): Promise<DiffusionModelFields> {
  const models = await llmModelRepo.loadAvailableDiffusionModels("novelai", false);
  const defaultModel = models?.find((model) => model.is_default === true);

  if (!defaultModel || defaultModel.diffusion_model_id === undefined) {
    throw new Error("No default NovelAI diffusion model found in database. Please seed the database.");
  }

  return defaultModel as DiffusionModelFields;
}

export function getLocalizedDiffusionModelDescription(model: DiffusionModelFields, locale: string): string {
  const normalizedLocale = locale.toLowerCase().split("-")[0];
  const description = normalizedLocale === "ja" ? model.ja_description : model.model_description;

  const baseDescription = description ?? model.model_description ?? `${model.provider} model`;

  const flags: string[] = [];
  if (model.is_free) flags.push("FREE");
  if (model.is_uncensored) flags.push("UNCENSORED");

  const flagPrefix = flags.length > 0 ? `(${flags.join("+")}) ` : "";
  return `${flagPrefix}${baseDescription}`;
}

export async function resolveNaiDiffusionModel(
  config: NaiDiffusionModelConfig,
): Promise<ResolvedNaiDiffusionModel | null> {
  if (config.nai_diffusion_model_id != null) {
    const overrideModel = await getDiffusionModelById(config.nai_diffusion_model_id);
    if (overrideModel?.provider === "novelai") {
      return {
        diffusionModelId: overrideModel.diffusion_model_id,
        codename: overrideModel.codename,
        source: "override",
      };
    }

    log.warn(
      overrideModel
        ? `[NAI] Configured nai_diffusion_model_id "${overrideModel.codename}" (provider: ${overrideModel.provider}) is not a NovelAI model. Ignoring dedicated override.`
        : `[NAI] Configured nai_diffusion_model_id ${config.nai_diffusion_model_id} was not found. Ignoring dedicated override.`,
    );
  }

  return null;
}
