import type {
  CustomEndpointRow,
  PersonalProviderCapability,
  UserSavedProviderConfigRow,
  UserSavedProviderConfigUpsert,
} from "@/types/db/schema";
import { configRepository, llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import {
  getNovelAIProfile,
  getNovelAISamplerConfig,
  enableNovelAIPresetSamplers,
  isNovelAITextModel,
} from "@/providers/novelai/modelProfiles";
import { prunePrimaryFallbackRefs } from "@/utils/provider/fallbackModelIdentity";
import { writeProviderSpeechSelection } from "@/utils/provider/providerOptionRegistry";
import { setHostedSpeechSelection, setHostedTranscriptionSelection } from "@/utils/db/repositories/SpeechRepository";

function sortProviderRows(rows: UserSavedProviderConfigRow[]): UserSavedProviderConfigRow[] {
  return [...rows].sort((left, right) => left.provider.localeCompare(right.provider));
}

export function hasConfiguredPersonalModel(
  row: UserSavedProviderConfigRow,
  capability: PersonalProviderCapability,
): boolean {
  switch (capability) {
    case "text":
      return row.llm_id !== null;
    case "embedding":
      return row.embedding_model_id !== null;
    case "image":
      return row.diffusion_model_id !== null;
    case "image_nai":
      return row.nai_diffusion_model_id !== null;
    case "video":
      return row.video_model_id !== null;
    case "vision":
      return row.vision_llm_id !== null;
    case "speech_design":
      return row.speech_design_model_id != null;
    case "speech_clone":
      return row.speech_clone_model_id != null;
    case "transcription":
      return row.transcription_model_id != null;
  }
}

export function getActivePersonalProviderForCapability(
  rows: UserSavedProviderConfigRow[],
  capability: PersonalProviderCapability,
): UserSavedProviderConfigRow | null {
  return (
    sortProviderRows(rows).find(
      (row) => row.enabled_capabilities.includes(capability) && hasConfiguredPersonalModel(row, capability),
    ) ?? null
  );
}

// Capability ownership stays intact even when disabled, because re-deriving without it falls back to alphabetical
// order and silently moves user routes.
export function getAssignedPersonalProviderForCapability(
  rows: UserSavedProviderConfigRow[],
  capability: PersonalProviderCapability,
): UserSavedProviderConfigRow | null {
  return sortProviderRows(rows).find((row) => row.assigned_capabilities.includes(capability)) ?? null;
}

// Alphabetical fallback for pre-migration-060 or unassigned users only, because consulting it after an assignment
// exists overrides the user's chosen route.
export function getStoredPersonalProviderForCapability(
  rows: UserSavedProviderConfigRow[],
  capability: PersonalProviderCapability,
): UserSavedProviderConfigRow | null {
  return (
    getAssignedPersonalProviderForCapability(rows, capability) ??
    sortProviderRows(rows).find((row) => hasConfiguredPersonalModel(row, capability)) ??
    null
  );
}

type FallbackIdentityEndpoint = Pick<CustomEndpointRow, "custom_endpoint_id" | "model_ref_id">;

// Primary-matching fallback entries must be pruned because untouched modal slots resubmit stale refs and would reject
// every later fallback edit.
export async function prunePersonalFallbackChain(
  userId: number,
  primaryLlmId: number | null,
  endpoints: Iterable<FallbackIdentityEndpoint> = [],
  credentialProvider?: string,
): Promise<boolean> {
  const { fallback_model_refs: refs } = await llmProviderRepo.loadPersonalFallbackSettings(userId);
  const pruned = prunePrimaryFallbackRefs(refs, primaryLlmId, endpoints, credentialProvider);
  if (pruned.length === refs.length) return true;
  return await llmProviderRepo.updatePersonalFallbackModelRefs(userId, pruned);
}

export async function setPersonalTextPrimary(
  userId: number,
  provider: string,
  llmId: number,
  endpoints: Iterable<FallbackIdentityEndpoint> = [],
): Promise<boolean> {
  const model = provider.toLowerCase() === "novelai" ? await llmModelRepo.loadById(llmId) : null;
  // A stored row is a user-registered codename, so one without a NovelAI profile must refuse instead of throwing.
  if (provider.toLowerCase() === "novelai" && (!model || !isNovelAITextModel(model.llm_codename))) return false;
  const preset = model ? await configRepository.resolveNaiPreset(model.llm_codename) : undefined;
  if (model && getNovelAIProfile(model.llm_codename).samplingPresetTarget && !preset) return false;
  const assigned = await assignPersonalCapabilityToProvider(userId, provider, "text", (row) => ({
    ...row,
    ...(model && row.llm_id !== llmId
      ? {
          ...getNovelAISamplerConfig(model.llm_codename, preset),
          llm_disabled_params: enableNovelAIPresetSamplers(row.llm_disabled_params),
        }
      : {}),
    llm_id: llmId,
  }));
  return assigned && (await prunePersonalFallbackChain(userId, llmId, endpoints, provider));
}

// Enabling writes both arrays while disabling clears only enabled_capabilities, because dropping
// assigned_capabilities erases the user's provider choice.
export function withCapabilityEnabled(
  row: UserSavedProviderConfigRow,
  capability: PersonalProviderCapability,
  enabled: boolean,
): UserSavedProviderConfigUpsert {
  return {
    ...row,
    enabled_capabilities: enabled
      ? Array.from(new Set([...row.enabled_capabilities, capability]))
      : row.enabled_capabilities.filter((item) => item !== capability),
    assigned_capabilities: enabled
      ? Array.from(new Set([...row.assigned_capabilities, capability]))
      : row.assigned_capabilities,
  };
}

export function withCapabilityUnassigned(
  row: UserSavedProviderConfigRow,
  capability: PersonalProviderCapability,
): UserSavedProviderConfigUpsert {
  return {
    ...row,
    enabled_capabilities: row.enabled_capabilities.filter((item) => item !== capability),
    assigned_capabilities: row.assigned_capabilities.filter((item) => item !== capability),
  };
}

function claimsCapability(row: UserSavedProviderConfigRow, capability: PersonalProviderCapability): boolean {
  return row.enabled_capabilities.includes(capability) || row.assigned_capabilities.includes(capability);
}

// Ownership is exclusive so losing rows drop assigned_capabilities too, and returning false means the release write
// failed with ownership partly transferred.
async function releaseCapabilityFromProvider(
  userId: number,
  row: UserSavedProviderConfigRow,
  provider: string,
  capability: PersonalProviderCapability,
): Promise<boolean> {
  if (row.provider.toLowerCase() === provider.toLowerCase()) {
    return true;
  }
  if (!claimsCapability(row, capability)) {
    return true;
  }

  return await llmProviderRepo.upsertUserSavedProviderConfig(userId, withCapabilityUnassigned(row, capability));
}

export async function assignPersonalCapabilityToProvider(
  userId: number,
  provider: string,
  capability: PersonalProviderCapability,
  updater: (row: UserSavedProviderConfigRow) => UserSavedProviderConfigUpsert,
): Promise<boolean> {
  const rows = await llmProviderRepo.loadUserSavedProviderConfigs(userId);
  if (rows.length === 0) {
    return false;
  }

  if (capability === "speech_design" || capability === "speech_clone") {
    const row = rows.find((entry) => entry.provider === provider.toLowerCase());
    if (!row) return false;
    const next = updater(row);
    const mode = capability === "speech_design" ? "design" : "clone";
    const modelId = mode === "design" ? next.speech_design_model_id : next.speech_clone_model_id;
    return (
      modelId != null &&
      writeProviderSpeechSelection({ scope: { kind: "personal", ownerId: userId }, provider, modelId, mode }, () =>
        setHostedSpeechSelection({ kind: "personal", ownerId: userId }, modelId, mode),
      )
    );
  }

  if (capability === "transcription") {
    const row = rows.find((entry) => entry.provider === provider.toLowerCase());
    const modelId = row ? updater(row).transcription_model_id : null;
    return modelId != null && setHostedTranscriptionSelection({ kind: "personal", ownerId: userId }, modelId);
  }

  let updated = false;
  for (const row of rows) {
    if (row.provider.toLowerCase() === provider.toLowerCase()) {
      const nextRow = updater(row);
      const ok = await llmProviderRepo.upsertUserSavedProviderConfig(userId, {
        ...nextRow,
        enabled_capabilities: Array.from(new Set([...nextRow.enabled_capabilities, capability])),
        assigned_capabilities: Array.from(new Set([...nextRow.assigned_capabilities, capability])),
      });
      if (!ok) return false;
      updated = true;
      continue;
    }

    if (!(await releaseCapabilityFromProvider(userId, row, provider, capability))) {
      return false;
    }
  }

  return updated;
}

export async function setPersonalCapabilityEnabled(
  userId: number,
  capability: PersonalProviderCapability,
  enabled: boolean,
): Promise<boolean> {
  const rows = await llmProviderRepo.loadUserSavedProviderConfigs(userId);

  if (!enabled) {
    // Disabling clears only enabled_capabilities without reassigning and succeeds on unconfigured slots because the
    // quick-toggle modal ANDs all six results.
    for (const row of rows) {
      if (!row.enabled_capabilities.includes(capability)) {
        continue;
      }
      const ok = await llmProviderRepo.upsertUserSavedProviderConfig(
        userId,
        withCapabilityEnabled(row, capability, false),
      );
      if (!ok) return false;
    }
    return true;
  }

  const targetRow = getStoredPersonalProviderForCapability(rows, capability);
  if (!targetRow) {
    return false;
  }

  for (const row of rows) {
    if (row.provider.toLowerCase() === targetRow.provider.toLowerCase()) {
      const ok = await llmProviderRepo.upsertUserSavedProviderConfig(
        userId,
        withCapabilityEnabled(row, capability, true),
      );
      if (!ok) return false;
      continue;
    }

    if (!(await releaseCapabilityFromProvider(userId, row, targetRow.provider, capability))) {
      return false;
    }
  }

  return true;
}
