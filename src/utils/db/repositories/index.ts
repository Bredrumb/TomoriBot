import type { Guild } from "discord.js";
import type { NaiPresetRow, SetupConfig, TomoriConfigRow, TomoriRow, UserRow } from "@/types/db/schema";
import { configRepository } from "./ConfigRepository";
import { cooldownRepository } from "./CooldownRepository";
import { exportRepository } from "./ExportRepository";
import { importRepository } from "./ImportRepository";
import { llmModelRepo } from "./LlmModelRepository";
import { llmOverrideRepo } from "./LlmOverrideRepository";
import { llmProviderRepo } from "./LlmProviderRepository";
import { personalMemoryRepository } from "./PersonalMemoryRepository";
import { personaRepository } from "./PersonaRepository";
import { serverMemoryRepository } from "./ServerMemoryRepository";
import { presetRepository } from "./PresetRepository";
import { serverRepository } from "./ServerRepository";
import { serverScheduleRepository } from "./ServerScheduleRepository";
import { toolRepository } from "./ToolRepository";
import { whitelistRepository } from "./WhitelistRepository";
import { userRepository } from "./UserRepository";

export {
  configRepository,
  cooldownRepository,
  exportRepository,
  importRepository,
  llmModelRepo,
  llmOverrideRepo,
  llmProviderRepo,
  personalMemoryRepository,
  personaRepository,
  presetRepository,
  serverMemoryRepository,
  serverRepository,
  serverScheduleRepository,
  toolRepository,
  userRepository,
  whitelistRepository,
};
export type { OpenRouterModelScope } from "./LlmModelRepository";

// ── model catalog reads ────────────────────────────────────────────────────────
export const getLlmsByIds = (ids: number[]) => llmModelRepo.getLlmsByIds(ids);
export const loadNaiPresetsForModel = (target: "kayra" | "erato") => configRepository.loadNaiPresets(target);
export const loadAvailableLlms = (includeDeprecated = false) => llmModelRepo.loadAvailableLlms(includeDeprecated);
export const loadAvailableModelsForProvider = (
  ...args: Parameters<typeof llmModelRepo.loadAvailableModelsForProvider>
) => llmModelRepo.loadAvailableModelsForProvider(...args);
export const loadLlmById = (llmId: number) => llmModelRepo.loadById(llmId);
export const loadLlmByProviderAndCodename = (provider: string, codename: string) =>
  llmModelRepo.loadByProviderAndCodename(provider, codename);
export const loadDefaultModelForProvider = (providerName: string) => llmModelRepo.loadDefaultModel(providerName);
export const loadAvailableEmbeddingModelsForProvider = (
  ...args: Parameters<typeof llmModelRepo.loadAvailableEmbeddingModels>
) => llmModelRepo.loadAvailableEmbeddingModels(...args);
export const loadDefaultEmbeddingModelForProvider = (providerName: string) =>
  llmModelRepo.loadDefaultEmbeddingModel(providerName);
export const loadAvailableDiffusionModelsForProvider = (
  ...args: Parameters<typeof llmModelRepo.loadAvailableDiffusionModels>
) => llmModelRepo.loadAvailableDiffusionModels(...args);
export const loadDefaultDiffusionModelForProvider = (providerName: string) =>
  llmModelRepo.loadDefaultDiffusionModel(providerName);
export const loadAvailableVideoGenerationModelsForProvider = (
  ...args: Parameters<typeof llmModelRepo.loadAvailableVideoGenerationModels>
) => llmModelRepo.loadAvailableVideoGenerationModels(...args);
export const loadDefaultVideoGenerationModelForProvider = (providerName: string) =>
  llmModelRepo.loadDefaultVideoGenerationModel(providerName);
export const loadDefaultVisionModelForProvider = (providerName: string) =>
  llmModelRepo.loadDefaultVisionModel(providerName);
export const loadEmbeddingModelById = (embeddingModelId: number) =>
  llmModelRepo.loadEmbeddingModelById(embeddingModelId);
export const loadEmbeddingModelByProviderAndCodename = (provider: string, codename: string) =>
  llmModelRepo.loadEmbeddingModelByProviderAndCodename(provider, codename);
export const loadDiffusionModelByProviderAndCodename = (provider: string, codename: string) =>
  llmModelRepo.loadDiffusionModelByProviderAndCodename(provider, codename);
export const loadVideoGenerationModelByProviderAndCodename = (provider: string, codename: string) =>
  llmModelRepo.loadVideoGenerationModelByProviderAndCodename(provider, codename);
export const loadSmartestModel = (providerName: string, includeDeprecated = false) =>
  llmModelRepo.loadSmartestModel(providerName, includeDeprecated);
export const loadUniqueProviders = (includeDeprecated = false) => llmModelRepo.loadUniqueProviders(includeDeprecated);

// ── provider / registration / custom endpoint reads ────────────────────────────
export const loadSavedProviderConfigs = (serverId: number) => llmProviderRepo.loadSavedProviderConfigs(serverId);
export const loadSavedProviderConfig = (serverId: number, provider: string) =>
  llmProviderRepo.loadSavedProviderConfig(serverId, provider);
export const loadUserSavedProviderConfigs = (userId: number) => llmProviderRepo.loadUserSavedProviderConfigs(userId);
export const loadUserSavedProviderConfig = (userId: number, provider: string) =>
  llmProviderRepo.loadUserSavedProviderConfig(userId, provider);
export const loadOpenRouterModelRegistrationsForServer = (serverId: number) =>
  llmProviderRepo.loadOpenRouterModelRegistrationsForServer(serverId);
export const loadOpenRouterModelRegistrationsForUser = (userId: number) =>
  llmProviderRepo.loadOpenRouterModelRegistrationsForUser(userId);
export const loadOpenRouterEmbeddingModelRegistrationsForServer = (serverId: number) =>
  llmProviderRepo.loadOpenRouterEmbeddingModelRegistrationsForServer(serverId);
export const loadOpenRouterEmbeddingModelRegistrationsForUser = (userId: number) =>
  llmProviderRepo.loadOpenRouterEmbeddingModelRegistrationsForUser(userId);
export const loadOpenRouterImageModelRegistrationsForServer = (serverId: number) =>
  llmProviderRepo.loadOpenRouterImageModelRegistrationsForServer(serverId);
export const loadOpenRouterImageModelRegistrationsForUser = (userId: number) =>
  llmProviderRepo.loadOpenRouterImageModelRegistrationsForUser(userId);
export const loadOpenRouterVideoModelRegistrationsForServer = (serverId: number) =>
  llmProviderRepo.loadOpenRouterVideoModelRegistrationsForServer(serverId);
export const loadOpenRouterVideoModelRegistrationsForUser = (userId: number) =>
  llmProviderRepo.loadOpenRouterVideoModelRegistrationsForUser(userId);
export const loadScopedOpenRouterModels = (...args: Parameters<typeof llmProviderRepo.loadScopedOpenRouterModels>) =>
  llmProviderRepo.loadScopedOpenRouterModels(...args);
export const loadScopedOpenRouterEmbeddingModels = (
  ...args: Parameters<typeof llmProviderRepo.loadScopedOpenRouterEmbeddingModels>
) => llmProviderRepo.loadScopedOpenRouterEmbeddingModels(...args);
export const loadScopedOpenRouterDiffusionModels = (
  ...args: Parameters<typeof llmProviderRepo.loadScopedOpenRouterDiffusionModels>
) => llmProviderRepo.loadScopedOpenRouterDiffusionModels(...args);
export const loadScopedOpenRouterVideoGenerationModels = (
  ...args: Parameters<typeof llmProviderRepo.loadScopedOpenRouterVideoGenerationModels>
) => llmProviderRepo.loadScopedOpenRouterVideoGenerationModels(...args);
export const loadCustomEndpointsForServer = (serverId: number) =>
  llmProviderRepo.loadCustomEndpointsForServer(serverId);
export const loadCustomEndpointsForUser = (userId: number) => llmProviderRepo.loadCustomEndpointsForUser(userId);
export const loadCustomEndpointsByIds = (ids: number[]) => llmProviderRepo.loadCustomEndpointsByIds(ids);
export const loadCustomEndpoint = (...args: Parameters<typeof llmProviderRepo.loadCustomEndpoint>) =>
  llmProviderRepo.loadCustomEndpoint(...args);

// ── channel / persona override reads ──────────────────────────────────────────
export const getChannelLlmOverride = (serverId: number, channelDiscId: string) =>
  llmOverrideRepo.getChannelLlmOverride(serverId, channelDiscId);
export const getAllChannelLlmOverridesForServer = (serverId: number) =>
  llmOverrideRepo.getAllChannelLlmOverridesForServer(serverId);
export const loadPersonaLlmOverridesForServer = (serverId: number) =>
  llmOverrideRepo.loadPersonaLlmOverridesForServer(serverId);

// ── general reads ──────────────────────────────────────────────────────────────
export const loadTomoriState = (serverDiscId: string) => personaRepository.loadState(serverDiscId);
export const loadAllPersonasForServer = (serverDiscId: string) => personaRepository.loadAllForServer(serverDiscId);
export const loadUserRow = (userDiscId: string) => userRepository.loadByDiscordId(userDiscId);
export const loadUserRowsByNormalizedNickname = (normalizedNickname: string) =>
  userRepository.findByNormalizedNickname(normalizedNickname);
export const loadPersonaConfigRow = (tomoriId: number) => personaRepository.loadPersonaConfig(tomoriId);
export const loadPersonalMemoriesForUserLineage = (userId: number, personaLineageId: number, includeGlobal: boolean) =>
  personalMemoryRepository.loadForUserLineage(userId, personaLineageId, includeGlobal);
export const isBlacklisted = (serverDiscId: string, userDiscId: string) =>
  userRepository.isBlacklisted(serverDiscId, userDiscId);
export const getPrivacyLevel = (userDiscId: string) => userRepository.getPrivacyLevel(userDiscId);
export const isPrivacyOptedOut = (userDiscId: string) => userRepository.isPrivacyOptedOut(userDiscId);
export const getCrossServerShortTermMemoryOptIn = (userDiscId: string) =>
  userRepository.getCrossServerShmOptIn(userDiscId);
export const loadServerEmojis = (internalServerId: number) => serverRepository.loadEmojis(internalServerId);
export const loadPresetOptions = (maxDescriptionLength?: number) =>
  configRepository.loadPresetOptions(maxDescriptionLength);
export const loadPresetOptionsByLocale = (locale: string, maxDescriptionLength?: number) =>
  configRepository.loadPresetOptionsByLocale(locale, maxDescriptionLength);
export const loadPresetRowsByLocale = (locale: string) => configRepository.loadPresetRowsByLocale(locale);
export const loadAllPresets = () => configRepository.loadAllPresets();
export const loadSystemPromptPresets = () => configRepository.loadSystemPromptPresets();
export const loadServerStickers = (serverDiscId: string) => serverRepository.loadStickers(serverDiscId);
export const getDueReminders = () => serverScheduleRepository.getDueReminders();
export const getNextReminderTime = () => serverScheduleRepository.getNextReminderTime();
export const getReminderById = (reminderId: number) => serverScheduleRepository.getReminderById(reminderId);
export const getUserReminderCount = (userDiscordId: string) =>
  serverScheduleRepository.getUserReminderCount(userDiscordId);
export const deleteReminderById = (reminderId: number) => serverScheduleRepository.deleteReminderById(reminderId);
export const getPendingRemindersForUser = (
  ...args: Parameters<typeof serverScheduleRepository.getPendingRemindersForUser>
) => serverScheduleRepository.getPendingRemindersForUser(...args);
export const getBraveApiKeyStatus = (serverId: number) => toolRepository.getBraveApiKeyStatus(serverId);
export const getBlacklistedMemberIds = (serverId: number) => userRepository.getBlacklistedMemberIds(serverId);
export const getDueRandomTriggers = () => serverScheduleRepository.getDueTriggers();
export const getNextRandomTriggerTime = () => serverScheduleRepository.getNextTriggerTime();
export const getServerRandomTriggers = (serverId: number) => serverScheduleRepository.getServerTriggers(serverId);
export const getServerRandomTriggerCount = (serverId: number) =>
  serverScheduleRepository.getServerTriggerCount(serverId);
export const getRandomTriggerByPersonaAndChannel = (
  ...args: Parameters<typeof serverScheduleRepository.getTriggerByPersonaAndChannel>
) => serverScheduleRepository.getTriggerByPersonaAndChannel(...args);

// ── writes ─────────────────────────────────────────────────────────────────────
export const registerUser = (userDiscId: string, displayName: string, language = "en") =>
  userRepository.register(userDiscId, displayName, language);
export const setPrivacyLevel = (userDiscId: string, level: UserRow["privacy_level"]) =>
  userRepository.setPrivacyLevel(userDiscId, level);
export const setPrivacyOptOut = (userDiscId: string, optedOut: boolean) =>
  userRepository.setPrivacyOptOut(userDiscId, optedOut);
export const toggleCrossServerShortTermMemoryOptIn = (userDiscId: string) =>
  userRepository.toggleCrossServerShmOptIn(userDiscId);
export const incrementTomoriCounter = (tomoriId: number, minThreshold: number, maxThreshold: number) =>
  configRepository.incrementTomoriCounter(tomoriId, minThreshold, maxThreshold);
export const setupServer = (guild: Guild | null, config: SetupConfig) => serverRepository.setup(guild, config);
export const updateTomoriConfig = (serverId: number, configData: Partial<TomoriConfigRow>, serverDiscId?: string) =>
  configRepository.update(serverId, configData, serverDiscId);
export const applyNaiPreset = (serverId: number, preset: NaiPresetRow, model: string, serverDiscId?: string) =>
  configRepository.applyNaiPreset(serverId, preset, model, serverDiscId);
export const updateTomori = (tomoriId: number, tomoriData: Partial<TomoriRow>, serverDiscId?: string) =>
  personaRepository.update(tomoriId, tomoriData, serverDiscId);
export const updateUser = (userId: number, userData: Partial<UserRow>) => userRepository.update(userId, userData);
export const addServerMemoryByTomori = (
  serverId: number,
  tomoriId: number,
  personaLineageId: number,
  taughtByUserId: number,
  memoryContent: string,
  tags: string[] = [],
) => serverMemoryRepository.add(serverId, tomoriId, personaLineageId, taughtByUserId, memoryContent, tags);
export const addPersonalMemoryByTomori = (
  userId: number,
  personaLineageId: number,
  memoryContent: string,
  tags: string[] = [],
) => personalMemoryRepository.add(userId, personaLineageId, memoryContent, tags);
export const addReminder = (...args: Parameters<typeof serverScheduleRepository.addReminder>) =>
  serverScheduleRepository.addReminder(...args);
export const rescheduleReminder = (...args: Parameters<typeof serverScheduleRepository.rescheduleReminder>) =>
  serverScheduleRepository.rescheduleReminder(...args);
export const updateReminder = (...args: Parameters<typeof serverScheduleRepository.updateReminder>) =>
  serverScheduleRepository.updateReminder(...args);
export const insertRandomTrigger = (...args: Parameters<typeof serverScheduleRepository.insertTrigger>) =>
  serverScheduleRepository.insertTrigger(...args);
export const upsertRandomTrigger = (...args: Parameters<typeof serverScheduleRepository.upsertTrigger>) =>
  serverScheduleRepository.upsertTrigger(...args);
export const deleteRandomTrigger = (triggerId: number) => serverScheduleRepository.deleteTrigger(triggerId);
export const rescheduleRandomTrigger = (...args: Parameters<typeof serverScheduleRepository.rescheduleTrigger>) =>
  serverScheduleRepository.rescheduleTrigger(...args);

// ── override / fallback writes ─────────────────────────────────────────────────
export const setChannelLlmOverride = (...args: Parameters<typeof llmOverrideRepo.setChannelLlmOverride>) =>
  llmOverrideRepo.setChannelLlmOverride(...args);
export const setPersonaLlmOverride = (...args: Parameters<typeof llmOverrideRepo.setPersonaLlmOverride>) =>
  llmOverrideRepo.setPersonaLlmOverride(...args);
export const setFallbackLlms = (...args: Parameters<typeof llmOverrideRepo.setFallbackLlms>) =>
  llmOverrideRepo.setFallbackLlms(...args);
export const setFallbackModelRefs = (...args: Parameters<typeof llmOverrideRepo.setFallbackModelRefs>) =>
  llmOverrideRepo.setFallbackModelRefs(...args);
export const deleteChannelLlmOverride = (...args: Parameters<typeof llmOverrideRepo.deleteChannelLlmOverride>) =>
  llmOverrideRepo.deleteChannelLlmOverride(...args);
export const clearAllChannelLlmOverridesForServer = (
  ...args: Parameters<typeof llmOverrideRepo.clearAllChannelLlmOverridesForServer>
) => llmOverrideRepo.clearAllChannelLlmOverridesForServer(...args);
export const clearAllPersonaLlmOverridesForServer = (
  ...args: Parameters<typeof llmOverrideRepo.clearAllPersonaLlmOverridesForServer>
) => llmOverrideRepo.clearAllPersonaLlmOverridesForServer(...args);
export const restoreOverridesFromSnapshot = (
  ...args: Parameters<typeof llmOverrideRepo.restoreOverridesFromSnapshot>
) => llmOverrideRepo.restoreOverridesFromSnapshot(...args);
export const cleanupDeadChannelOverrides = (serverId: number, validChannelIds: Set<string>) =>
  llmOverrideRepo.cleanupDeadChannelOverrides(serverId, validChannelIds);

// ── provider / endpoint writes ─────────────────────────────────────────────────
export const upsertSavedProviderConfig = (...args: Parameters<typeof llmProviderRepo.upsertSavedProviderConfig>) =>
  llmProviderRepo.upsertSavedProviderConfig(...args);
export const deleteSavedProviderConfig = (...args: Parameters<typeof llmProviderRepo.deleteSavedProviderConfig>) =>
  llmProviderRepo.deleteSavedProviderConfig(...args);
export const upsertUserSavedProviderConfig = (
  ...args: Parameters<typeof llmProviderRepo.upsertUserSavedProviderConfig>
) => llmProviderRepo.upsertUserSavedProviderConfig(...args);
export const deleteUserSavedProviderConfig = (userId: number, provider: string) =>
  llmProviderRepo.deleteUserSavedProviderConfig(userId, provider);
export const upsertCustomEndpoint = (...args: Parameters<typeof llmProviderRepo.upsertCustomEndpoint>) =>
  llmProviderRepo.upsertCustomEndpoint(...args);
export const deleteCustomEndpoint = (...args: Parameters<typeof llmProviderRepo.deleteCustomEndpoint>) =>
  llmProviderRepo.deleteCustomEndpoint(...args);
export const upsertOpenRouterModelRegistration = (
  ...args: Parameters<typeof llmProviderRepo.upsertOpenRouterModelRegistration>
) => llmProviderRepo.upsertOpenRouterModelRegistration(...args);
export const deleteOpenRouterModelRegistration = (
  ...args: Parameters<typeof llmProviderRepo.deleteOpenRouterModelRegistration>
) => llmProviderRepo.deleteOpenRouterModelRegistration(...args);
export const upsertOpenRouterEmbeddingModelRegistration = (
  ...args: Parameters<typeof llmProviderRepo.upsertOpenRouterEmbeddingModelRegistration>
) => llmProviderRepo.upsertOpenRouterEmbeddingModelRegistration(...args);
export const deleteOpenRouterEmbeddingModelRegistration = (
  ...args: Parameters<typeof llmProviderRepo.deleteOpenRouterEmbeddingModelRegistration>
) => llmProviderRepo.deleteOpenRouterEmbeddingModelRegistration(...args);
export const upsertOpenRouterImageModelRegistration = (
  ...args: Parameters<typeof llmProviderRepo.upsertOpenRouterImageModelRegistration>
) => llmProviderRepo.upsertOpenRouterImageModelRegistration(...args);
export const deleteOpenRouterImageModelRegistration = (
  ...args: Parameters<typeof llmProviderRepo.deleteOpenRouterImageModelRegistration>
) => llmProviderRepo.deleteOpenRouterImageModelRegistration(...args);
export const upsertOpenRouterVideoModelRegistration = (
  ...args: Parameters<typeof llmProviderRepo.upsertOpenRouterVideoModelRegistration>
) => llmProviderRepo.upsertOpenRouterVideoModelRegistration(...args);
export const deleteOpenRouterVideoModelRegistration = (
  ...args: Parameters<typeof llmProviderRepo.deleteOpenRouterVideoModelRegistration>
) => llmProviderRepo.deleteOpenRouterVideoModelRegistration(...args);

// ── export / import ────────────────────────────────────────────────────────────
export const exportPersonalData = (...args: Parameters<typeof exportRepository.exportPersonalData>) =>
  exportRepository.exportPersonalData(...args);
export const exportServerData = (...args: Parameters<typeof exportRepository.exportServerData>) =>
  exportRepository.exportServerData(...args);
export const exportPersonaPersonalMemories = (userDiscId: string, personaLineageId: number) =>
  exportRepository.exportPersonaPersonalMemories(userDiscId, personaLineageId);
export const exportGlobalPersonalMemories = (userDiscId: string) =>
  exportRepository.exportGlobalPersonalMemories(userDiscId);
export const exportPersonalSettings = (userDiscId: string) => exportRepository.exportPersonalSettings(userDiscId);
export const exportPersonaServerMemories = (serverDiscId: string, tomoriId: number) =>
  exportRepository.exportPersonaServerMemories(serverDiscId, tomoriId);
export const exportServerConfig = (serverDiscId: string) => exportRepository.exportServerConfig(serverDiscId);
export const exportPersonalityData = (...args: Parameters<typeof exportRepository.exportPersonalityData>) =>
  exportRepository.exportPersonalityData(...args);
export const importPersonalMemories = (...args: Parameters<typeof importRepository.importPersonalMemories>) =>
  importRepository.importPersonalMemories(...args);
export const importPersonalSettings = (...args: Parameters<typeof importRepository.importPersonalSettings>) =>
  importRepository.importPersonalSettings(...args);
export const importServerConfig = (...args: Parameters<typeof importRepository.importServerConfig>) =>
  importRepository.importServerConfig(...args);
export const importServerMemories = (...args: Parameters<typeof importRepository.importServerMemories>) =>
  importRepository.importServerMemories(...args);
export const importPersonalData = (...args: Parameters<typeof importRepository.importPersonalData>) =>
  importRepository.importPersonalData(...args);
export const importServerData = (...args: Parameters<typeof importRepository.importServerData>) =>
  importRepository.importServerData(...args);
export const validateImportFile = (jsonData: unknown) => importRepository.validateImportFile(jsonData);
export type { ImportValidationResult, ImportFileType } from "./ImportRepository";
