import {
  findProviderRequestDeniedError,
  type ProviderRequestDeniedError,
  type ProviderUsageContext,
} from "@/utils/provider/providerUsage";
import { findProviderOption } from "@/utils/provider/providerOptionRegistry";
import type { VoiceSourceMode } from "@/utils/speech/voiceSourceCapabilities";
import { createHash } from "node:crypto";
import type { CustomEndpointRow } from "@/types/db/schema";
import { loadHostedSpeechSelection, type HostedSpeechSelection } from "@/utils/db/repositories/SpeechRepository";
import { log } from "@/utils/misc/logger";
import { buildCustomProviderName } from "@/utils/provider/customProviderUtils";
import { decryptApiKey } from "@/utils/security/crypto";
import type { GenerationModelSelection } from "@/types/provider/generationModels";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { GenerationModelUnavailableError, validateGenerationModelSelection } from "@/utils/provider/generationModels";
import { supportsSpeechMode } from "@/utils/speech/voiceSourceCapabilities";
import {
  loadActiveEndpoint,
  loadEndpointCredentials,
  loadSpeechRoutingPolicy,
} from "@/utils/db/repositories/SpeechRepository";

export interface SpeechEndpointResult {
  endpoint: CustomEndpointRow;
  /** Empty string when requires_auth = false (local endpoint with no auth). */
  apiKey: string;
}

export type SpeechTargetResult =
  | (SpeechEndpointResult & { kind: "custom-endpoint"; owner: { kind: "server"; ownerId: number } })
  | (Omit<HostedSpeechSelection, "apiKey" | "keyVersion"> & {
      kind: "hosted-model";
      endpoint: null;
      apiKey: string;
      usageContext?: ProviderUsageContext;
    });

export function speechTargetSource(target: SpeechTargetResult | null | undefined) {
  return target?.kind === "hosted-model" ? target.model : (target?.endpoint ?? null);
}

export function speechTargetFingerprint(target: SpeechTargetResult | null | undefined): string {
  if (!target) return "none";
  return createHash("sha256")
    .update(
      JSON.stringify(
        target.kind === "hosted-model"
          ? [
              target.kind,
              target.model.speech_model_id,
              target.model.provider,
              target.model.codename,
              target.model.voice_mode,
              target.owner,
              target.credentialId,
              target.credentialRevision,
              target.credentialProvider,
              target.usageContext,
              target.apiKey,
            ]
          : [
              target.kind,
              target.endpoint.custom_endpoint_id,
              target.endpoint.connection_id,
              target.endpoint.api_style,
              target.endpoint.endpoint_url,
              target.endpoint.extra_config,
              target.owner,
              target.apiKey,
            ],
      ),
    )
    .digest("hex");
}

export function speechTargetLabel(target: SpeechTargetResult | null | undefined): string {
  return target?.kind === "hosted-model" ? target.model.codename : (target?.endpoint.label ?? "ElevenLabs");
}

async function resolveActiveEndpointByCapability(
  serverId: number,
  capability: VoiceSourceMode | "transcription",
): Promise<SpeechEndpointResult | null> {
  try {
    const endpoint = await loadActiveEndpoint(serverId, capability);

    if (!endpoint?.connection_id) {
      return null;
    }

    // Endpoints that don't require auth (local servers) need no key lookup.
    if (!endpoint.requires_auth) {
      return { endpoint, apiKey: "" };
    }

    // Credentials are stored in saved_provider_configs keyed by the internal provider name via repository
    const providerName = buildCustomProviderName(endpoint.connection_id);
    const configRow = await loadEndpointCredentials(serverId, providerName);

    if (!configRow?.api_key) {
      log.warn(
        `[SpeechResolver] No credentials found for ${capability} endpoint "${endpoint.label}" on server ${serverId}`,
      );
      return null;
    }

    let apiKey: string;
    try {
      apiKey = await decryptApiKey(configRow.api_key, configRow.key_version);
    } catch {
      log.warn(`[SpeechResolver] Failed to decrypt credentials for ${capability} endpoint on server ${serverId}`);
      return null;
    }

    if (!apiKey) {
      return null;
    }

    return { endpoint, apiKey };
  } catch (error) {
    log.warn(`[SpeechResolver] Error resolving ${capability} endpoint for server ${serverId}`, error);
    return null;
  }
}

/**
 * Resolves the active speech (TTS) endpoint and credentials for a server.
 * Returns null when no speech endpoint is registered.
 */
async function resolveActiveSpeechEndpoint(
  serverId: number,
  mode: VoiceSourceMode,
): Promise<SpeechEndpointResult | null> {
  return resolveActiveEndpointByCapability(serverId, mode);
}

/**
 * Resolves the active transcription (STT) endpoint and credentials for a server.
 * Returns null when no transcription endpoint is registered.
 */
export async function resolveActiveTranscriptionEndpoint(serverId: number): Promise<SpeechEndpointResult | null> {
  return resolveActiveEndpointByCapability(serverId, "transcription");
}

export async function resolveSpeechTargets(
  serverId: number,
  userId?: number,
  modelSelection?: GenerationModelSelection | null,
): Promise<{
  design: SpeechTargetResult | null;
  clone: SpeechTargetResult | null;
  denials?: Partial<Record<VoiceSourceMode, ProviderRequestDeniedError>>;
}> {
  if (modelSelection) {
    if (modelSelection.kind !== "speech" && modelSelection.kind !== "speech-endpoint")
      throw new GenerationModelUnavailableError();
    await validateGenerationModelSelection(serverId, userId ?? null, modelSelection);
    const saved =
      modelSelection.source === "personal" && userId !== undefined
        ? await llmProviderRepo.loadUserSavedProviderConfig(userId, modelSelection.provider)
        : modelSelection.source === "server"
          ? await llmProviderRepo.loadSavedProviderConfig(serverId, modelSelection.provider)
          : null;
    let target: SpeechTargetResult;
    if (modelSelection.kind === "speech-endpoint") {
      const endpoint = (await llmProviderRepo.loadCustomEndpointsForServer(serverId)).find(
        (entry) => entry.custom_endpoint_id === modelSelection.modelId,
      );
      if (!endpoint || (endpoint.requires_auth && !saved?.api_key)) throw new GenerationModelUnavailableError();
      const apiKey =
        endpoint.requires_auth && saved?.api_key ? await decryptApiKey(saved.api_key, saved.key_version) : "";
      if (endpoint.requires_auth && !apiKey) throw new GenerationModelUnavailableError();
      target = { kind: "custom-endpoint", endpoint, apiKey, owner: { kind: "server", ownerId: serverId } };
    } else {
      const model = await llmModelRepo.loadSpeechModelById(modelSelection.modelId);
      if (!model || !saved) throw new GenerationModelUnavailableError();
      const personal = "user_id" in saved;
      const credentialId = personal ? saved.user_saved_config_id : saved.saved_config_id;
      if (credentialId === undefined) throw new GenerationModelUnavailableError();
      target = await resolveHostedSpeechTarget({
        model,
        apiKey: saved.api_key,
        keyVersion: saved.key_version,
        owner: personal ? { kind: "personal", ownerId: saved.user_id } : { kind: "server", ownerId: serverId },
        credentialId,
        credentialRevision: saved.credential_revision,
        credentialProvider: modelSelection.provider,
      });
    }
    const source = speechTargetSource(target);
    return {
      design: source && supportsSpeechMode(source, "design") ? target : null,
      clone: source && supportsSpeechMode(source, "clone") ? target : null,
    };
  }
  const serverAllowed = userId === undefined || (await loadSpeechRoutingPolicy(serverId, userId)).serverAllowed;
  const denials: Partial<Record<VoiceSourceMode, ProviderRequestDeniedError>> = {};
  async function resolve(mode: VoiceSourceMode): Promise<SpeechTargetResult | null> {
    const hosted = await loadHostedSpeechSelection(serverId, mode, userId);
    if (hosted) {
      if (hosted.owner.kind === "server" && !serverAllowed) return null;
      try {
        return await resolveHostedSpeechTarget(hosted);
      } catch (error) {
        const denied = findProviderRequestDeniedError(error);
        if (denied) denials[mode] = denied;
        log.warn("SpeechResolver: hosted credential unavailable", error, {
          serverId,
          metadata: { mode, owner: hosted.owner },
        });
        return null;
      }
    }
    if (!serverAllowed) return null;
    const endpoint = await resolveActiveSpeechEndpoint(serverId, mode);
    return endpoint ? { ...endpoint, kind: "custom-endpoint", owner: { kind: "server", ownerId: serverId } } : null;
  }
  const [design, clone] = await Promise.all([resolve("design"), resolve("clone")]);
  return { design, clone, ...(Object.keys(denials).length > 0 ? { denials } : {}) };
}

async function resolveHostedSpeechTarget(
  hosted: HostedSpeechSelection,
): Promise<Extract<SpeechTargetResult, { kind: "hosted-model" }>> {
  const option = findProviderOption(hosted.credentialProvider);
  let apiKey: string | null = null;
  let usageContext: ProviderUsageContext | undefined;
  if (option) {
    const capability = hosted.model.voice_mode === "clone" ? "speech-clone" : "speech-design";
    if (
      !option.capabilities.includes(capability) ||
      !(await option.availability(hosted.owner)).eligible ||
      !option.selection.resolveCredentials
    )
      throw new GenerationModelUnavailableError();
    const credentials = await option.selection.resolveCredentials({
      scope: hosted.owner,
      capability,
      modelId: hosted.model.speech_model_id,
    });
    apiKey = credentials?.apiKey ?? null;
    usageContext = credentials?.usageContext;
  } else if (hosted.apiKey) {
    apiKey = await decryptApiKey(hosted.apiKey, hosted.keyVersion);
  }
  if (!apiKey) throw new GenerationModelUnavailableError();
  return { ...hosted, kind: "hosted-model", endpoint: null, apiKey, usageContext };
}
