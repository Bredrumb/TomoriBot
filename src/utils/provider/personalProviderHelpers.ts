import type {
  PersonalProviderCapability,
  UserSavedProviderConfigRow,
  UserSavedProviderConfigUpsert,
} from "@/types/db/schema";
import { llmProviderRepo } from "@/utils/db/repositories";

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
      return row.diffusion_model_id !== null || row.nai_diffusion_model_id !== null;
    case "video":
      return row.video_model_id !== null;
    case "vision":
      return row.vision_llm_id !== null;
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

export function getStoredPersonalProviderForCapability(
  rows: UserSavedProviderConfigRow[],
  capability: PersonalProviderCapability,
): UserSavedProviderConfigRow | null {
  return sortProviderRows(rows).find((row) => hasConfiguredPersonalModel(row, capability)) ?? null;
}

export function withCapabilityEnabled(
  row: UserSavedProviderConfigRow,
  capability: PersonalProviderCapability,
  enabled: boolean,
): UserSavedProviderConfigUpsert {
  const nextCapabilities = enabled
    ? Array.from(new Set([...row.enabled_capabilities, capability]))
    : row.enabled_capabilities.filter((item) => item !== capability);

  return {
    ...row,
    enabled_capabilities: nextCapabilities,
  };
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

  let updated = false;
  for (const row of rows) {
    if (row.provider.toLowerCase() === provider.toLowerCase()) {
      const nextRow = updater(row);
      const nextEnabled = Array.from(new Set([...nextRow.enabled_capabilities, capability]));
      await llmProviderRepo.upsertUserSavedProviderConfig(userId, {
        ...nextRow,
        enabled_capabilities: nextEnabled,
      });
      updated = true;
      continue;
    }

    if (row.enabled_capabilities.includes(capability)) {
      await llmProviderRepo.upsertUserSavedProviderConfig(userId, withCapabilityEnabled(row, capability, false));
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
  const targetRow =
    getActivePersonalProviderForCapability(rows, capability) ??
    getStoredPersonalProviderForCapability(rows, capability);
  if (!targetRow) {
    return false;
  }

  for (const row of rows) {
    if (!enabled) {
      if (row.enabled_capabilities.includes(capability)) {
        await llmProviderRepo.upsertUserSavedProviderConfig(userId, withCapabilityEnabled(row, capability, false));
      }
      continue;
    }

    if (row.provider.toLowerCase() === targetRow.provider.toLowerCase()) {
      await llmProviderRepo.upsertUserSavedProviderConfig(userId, withCapabilityEnabled(row, capability, enabled));
      continue;
    }

    if (row.enabled_capabilities.includes(capability)) {
      await llmProviderRepo.upsertUserSavedProviderConfig(userId, withCapabilityEnabled(row, capability, false));
    }
  }

  return true;
}

export async function loadActivePersonalTextProvider(userId: number): Promise<UserSavedProviderConfigRow | null> {
  const rows = await llmProviderRepo.loadUserSavedProviderConfigs(userId);
  return getActivePersonalProviderForCapability(rows, "text");
}

export async function loadPersonalProviderOrNull(
  userId: number,
  provider: string,
): Promise<UserSavedProviderConfigRow | null> {
  return await llmProviderRepo.loadUserSavedProviderConfig(userId, provider);
}
