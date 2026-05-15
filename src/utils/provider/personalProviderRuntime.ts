import type { PersonalProviderCapability, TomoriState, UserSavedProviderConfigRow } from "@/types/db/schema";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";

export interface PersonalProviderOverlayResult {
  tomoriState: TomoriState;
  activeConfigs: Partial<Record<PersonalProviderCapability, UserSavedProviderConfigRow>>;
}

function collectActiveConfigs(
  rows: UserSavedProviderConfigRow[],
): Partial<Record<PersonalProviderCapability, UserSavedProviderConfigRow>> {
  const active: Partial<Record<PersonalProviderCapability, UserSavedProviderConfigRow>> = {};

  for (const capability of ["text", "embedding", "image", "video", "vision"] as const) {
    const matches = rows.filter((row) => row.enabled_capabilities.includes(capability));
    if (matches.length === 0) {
      continue;
    }

    matches.sort((left, right) => left.provider.localeCompare(right.provider));
    if (matches.length > 1) {
      log.warn(
        `Multiple enabled personal providers matched capability ${capability} for user ${rows[0]?.user_id}. Falling back to ${matches[0].provider}.`,
      );
    }

    active[capability] = matches[0];
  }

  return active;
}

export async function applyPersonalProviderSelectionsToTomoriState(
  tomoriState: TomoriState,
  userId: number | null | undefined,
): Promise<PersonalProviderOverlayResult> {
  if (!userId) {
    return {
      tomoriState,
      activeConfigs: {},
    };
  }

  const rows = await llmProviderRepo.loadUserSavedProviderConfigs(userId);
  if (rows.length === 0) {
    return {
      tomoriState,
      activeConfigs: {},
    };
  }

  const activeConfigs = collectActiveConfigs(rows);
  const nextConfig = { ...tomoriState.config };

  if (activeConfigs.text) {
    nextConfig.llm_id = activeConfigs.text.llm_id ?? nextConfig.llm_id;
    nextConfig.api_key = activeConfigs.text.api_key;
    nextConfig.key_version = activeConfigs.text.key_version ?? nextConfig.key_version;
    nextConfig.llm_temperature = activeConfigs.text.llm_temperature ?? nextConfig.llm_temperature;
    nextConfig.llm_top_p = activeConfigs.text.llm_top_p ?? nextConfig.llm_top_p;
    nextConfig.llm_top_k = activeConfigs.text.llm_top_k ?? nextConfig.llm_top_k;
    nextConfig.llm_frequency_penalty = activeConfigs.text.llm_frequency_penalty ?? nextConfig.llm_frequency_penalty;
    nextConfig.llm_presence_penalty = activeConfigs.text.llm_presence_penalty ?? nextConfig.llm_presence_penalty;
    nextConfig.llm_min_p = activeConfigs.text.llm_min_p ?? nextConfig.llm_min_p;
    nextConfig.llm_disabled_params = activeConfigs.text.llm_disabled_params ?? nextConfig.llm_disabled_params;
    nextConfig.llm_logit_biases = activeConfigs.text.llm_logit_biases ?? nextConfig.llm_logit_biases;
    nextConfig.thinking_level = activeConfigs.text.thinking_level ?? nextConfig.thinking_level;
    nextConfig.fallback_llm_ids = activeConfigs.text.fallback_llm_ids ?? nextConfig.fallback_llm_ids;
    nextConfig.custom_endpoint_url = activeConfigs.text.custom_endpoint_url ?? nextConfig.custom_endpoint_url;
    nextConfig.custom_model_name = activeConfigs.text.custom_model_name ?? nextConfig.custom_model_name;
    nextConfig.custom_num_ctx = activeConfigs.text.custom_num_ctx ?? nextConfig.custom_num_ctx;
  }

  if (activeConfigs.embedding?.embedding_model_id) {
    nextConfig.embedding_model_id = activeConfigs.embedding.embedding_model_id;
  }
  if (activeConfigs.image?.diffusion_model_id) {
    nextConfig.diffusion_model_id = activeConfigs.image.diffusion_model_id;
  }
  if (activeConfigs.image?.nai_diffusion_model_id) {
    nextConfig.nai_diffusion_model_id = activeConfigs.image.nai_diffusion_model_id;
  }
  if (activeConfigs.video?.video_model_id) {
    nextConfig.video_model_id = activeConfigs.video.video_model_id;
  }
  if (activeConfigs.vision?.vision_llm_id) {
    nextConfig.vision_llm_id = activeConfigs.vision.vision_llm_id;
  }

  let nextLlm = tomoriState.llm;
  if (activeConfigs.text?.llm_id) {
    const personalLlm = await llmModelRepo.loadById(activeConfigs.text.llm_id);
    if (personalLlm) {
      nextLlm = personalLlm;
    }
  }

  let nextVisionLlm = tomoriState.vision_llm;
  if (activeConfigs.vision?.vision_llm_id) {
    const personalVisionLlm = await llmModelRepo.loadById(activeConfigs.vision.vision_llm_id);
    if (personalVisionLlm) {
      nextVisionLlm = personalVisionLlm;
    }
  }

  // Load personal fallback LLMs for text capability (isolate personal provider fallback chain)
  let nextFallbackLlms: typeof tomoriState.fallback_llms;
  if (activeConfigs.text?.fallback_llm_ids && activeConfigs.text.fallback_llm_ids.length > 0) {
    const personalFallbacks: typeof tomoriState.fallback_llms = [];
    for (const llmId of activeConfigs.text.fallback_llm_ids) {
      const fallbackLlm = await llmModelRepo.loadById(llmId);
      if (fallbackLlm) {
        personalFallbacks.push(fallbackLlm);
      }
    }
    if (personalFallbacks.length > 0) {
      nextFallbackLlms = personalFallbacks;
    }
  }

  return {
    tomoriState: {
      ...tomoriState,
      config: nextConfig,
      llm: nextLlm,
      vision_llm: nextVisionLlm,
      // Personal provider has isolated fallback chain; don't use server fallbacks
      fallback_llms: nextFallbackLlms,
      fallback_chain: undefined,
      rotation_keys: activeConfigs.text ? undefined : tomoriState.rotation_keys,
    },
    activeConfigs,
  };
}
