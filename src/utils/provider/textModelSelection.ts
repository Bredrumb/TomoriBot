import type { Message } from "discord.js";
import type { LlmRow, TomoriState } from "@/types/db/schema";
import { getCachedChannelLlm } from "@/utils/cache/channelLlmCache";
import { llmModelRepo } from "@/utils/db/repositories";
import {
  CredentialUnavailableError,
  getResolvedCapabilityModelId,
  type ResolvedCredentials,
} from "@/utils/provider/credentialResolver";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
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

/**
 * A chat turn's text model before its credentials apply; only a personal `planned` route takes the
 * personal overlay and skips the channel override.
 */
export async function resolveRouteTextModel(params: {
  state: TomoriState;
  route: "planned" | "server";
  textCredentialSource: "server" | "personal";
  personalRoutingUserId: number | null;
  channel: Message["channel"];
  isUserImpersonation: boolean;
  hasSceneModelSelection: boolean;
  llmOverrideCodename?: string;
}): Promise<{ base: TomoriState; llm: LlmRow }> {
  if (params.hasSceneModelSelection) return { base: params.state, llm: params.state.llm };
  if (params.route === "server" || params.textCredentialSource !== "personal") {
    return {
      base: params.state,
      llm: await resolveServerTextModel(
        params.state,
        params.channel,
        params.isUserImpersonation,
        params.llmOverrideCodename,
      ),
    };
  }
  const base = (await applyPersonalProviderSelectionsToTomoriState(params.state, params.personalRoutingUserId))
    .tomoriState;
  if (!params.llmOverrideCodename) return { base, llm: base.llm };
  return {
    base,
    llm: (await llmModelRepo.loadByProviderAndCodename(base.llm.llm_provider, params.llmOverrideCodename)) ?? {
      ...base.llm,
      llm_codename: params.llmOverrideCodename,
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
