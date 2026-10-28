import type { Message } from "discord.js";
import type { LlmRow, TomoriState } from "@/types/db/schema";
import { getCachedChannelLlm } from "@/utils/cache/channelLlmCache";
import { llmModelRepo } from "@/utils/db/repositories";
import {
  CredentialUnavailableError,
  getResolvedCapabilityModelId,
  type ResolvedCredentials,
} from "@/utils/provider/credentialResolver";
import { withSavedProviderConfig } from "@/utils/provider/savedProviderConfig";

export async function resolveTextCredentialState(
  state: TomoriState,
  credentials: ResolvedCredentials,
  capability: "text" | "vision" = "text",
): Promise<TomoriState> {
  const modelId = getResolvedCapabilityModelId(credentials, capability);
  const model = modelId === null ? null : await llmModelRepo.loadById(modelId);
  if (!model || model.is_deprecated || model.llm_provider.toLowerCase() !== credentials.provider)
    throw new CredentialUnavailableError(credentials.provider, capability, "missing_model_id", credentials.source);
  const base = withSavedProviderConfig(state, credentials.savedConfig);
  return {
    ...base,
    llm: model,
    config: {
      ...base.config,
      llm_id: modelId,
      llm_max_output_tokens: credentials.savedConfig?.llm_max_output_tokens ?? base.config.llm_max_output_tokens,
      custom_endpoint_url: credentials.customEndpoint?.endpoint_url ?? null,
      custom_model_name: credentials.customEndpoint?.model_name ?? null,
      custom_num_ctx: credentials.customEndpoint?.num_ctx ?? null,
    },
  };
}

export async function resolveServerTextModel(
  state: TomoriState,
  channel: Message["channel"],
  isUserImpersonation: boolean,
  overrideCodename?: string,
): Promise<LlmRow> {
  const channelModel = isUserImpersonation
    ? null
    : await getCachedChannelLlm(state.server_id, channel.id, channel.isThread() ? channel.parentId : null);
  const model = isUserImpersonation ? state.llm : (state.persona_llm ?? channelModel ?? state.llm);
  if (!overrideCodename || overrideCodename === model.llm_codename) return model;
  return (
    (await llmModelRepo.loadByProviderAndCodename(model.llm_provider, overrideCodename)) ?? {
      ...model,
      llm_codename: overrideCodename,
    }
  );
}
