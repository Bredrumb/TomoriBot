import type { AssembledServerConfig } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { llmModelRepo } from "@/utils/db/repositories/LlmModelRepository";

type NaiDiffusionModelSource = "override" | "shared" | "default";

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
