import type { Guild } from "discord.js";
import type {
  FallbackModelRef,
  NaiPresetRow,
  SetupConfig,
  TomoriConfigRow,
  TomoriRow,
  UserRow,
} from "@/types/db/schema";
import type { ServerConfigExport } from "@/types/db/dataExport";
import { configRepository } from "./ConfigRepository";
import { importExportRepository } from "./ImportExportRepository";
import { llmRepository, type OpenRouterModelScope } from "./LlmRepository";
import { personalMemoryRepository } from "./PersonalMemoryRepository";
import { personaRepository } from "./PersonaRepository";
import { serverMemoryRepository } from "./ServerMemoryRepository";
import { serverRepository } from "./ServerRepository";
import { toolRepository } from "./ToolRepository";
import { userRepository } from "./UserRepository";

export {
  configRepository,
  importExportRepository,
  llmRepository,
  personalMemoryRepository,
  personaRepository,
  serverMemoryRepository,
  serverRepository,
  toolRepository,
  userRepository,
};
export type { OpenRouterModelScope };

export const getLlmsByIds = (ids: number[]) => llmRepository.getLlmsByIds(ids);
export const loadNaiPresetsForModel = (target: "kayra" | "erato") => configRepository.loadNaiPresets(target);
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
export const loadAvailableLlms = (includeDeprecated = false) => llmRepository.loadAvailableLlms(includeDeprecated);
export const loadAvailableModelsForProvider = (
  providerName: string,
  includeDeprecated = false,
  scope?: OpenRouterModelScope,
) => llmRepository.loadAvailableModelsForProvider(providerName, includeDeprecated, scope);
export const loadLlmById = (llmId: number) => llmRepository.loadById(llmId);
export const loadLlmByProviderAndCodename = (provider: string, codename: string) =>
  llmRepository.loadByProviderAndCodename(provider, codename);
export const loadDefaultModelForProvider = (providerName: string) => llmRepository.loadDefaultModel(providerName);
export const loadAvailableEmbeddingModelsForProvider = (
  providerName: string,
  includeDeprecated = false,
  scope?: OpenRouterModelScope,
) => llmRepository.loadAvailableEmbeddingModels(providerName, includeDeprecated, scope);
export const loadDefaultEmbeddingModelForProvider = (providerName: string) =>
  llmRepository.loadDefaultEmbeddingModel(providerName);
export const loadAvailableDiffusionModelsForProvider = (
  providerName: string,
  includeDeprecated = false,
  scope?: OpenRouterModelScope,
) => llmRepository.loadAvailableDiffusionModels(providerName, includeDeprecated, scope);
export const loadDefaultDiffusionModelForProvider = (providerName: string) =>
  llmRepository.loadDefaultDiffusionModel(providerName);
export const loadAvailableVideoGenerationModelsForProvider = (
  providerName: string,
  includeDeprecated = false,
  scope?: OpenRouterModelScope,
) => llmRepository.loadAvailableVideoGenerationModels(providerName, includeDeprecated, scope);
export const loadDefaultVideoGenerationModelForProvider = (providerName: string) =>
  llmRepository.loadDefaultVideoGenerationModel(providerName);
export const loadDefaultVisionModelForProvider = (providerName: string) =>
  llmRepository.loadDefaultVisionModel(providerName);
export const loadEmbeddingModelById = (embeddingModelId: number) =>
  llmRepository.loadEmbeddingModelById(embeddingModelId);
export const loadEmbeddingModelByProviderAndCodename = (provider: string, codename: string) =>
  llmRepository.loadEmbeddingModelByProviderAndCodename(provider, codename);
export const loadDiffusionModelByProviderAndCodename = (provider: string, codename: string) =>
  llmRepository.loadDiffusionModelByProviderAndCodename(provider, codename);
export const loadVideoGenerationModelByProviderAndCodename = (provider: string, codename: string) =>
  llmRepository.loadVideoGenerationModelByProviderAndCodename(provider, codename);
export const loadSmartestModel = (providerName: string, includeDeprecated = false) =>
  llmRepository.loadSmartestModel(providerName, includeDeprecated);
export const loadUniqueProviders = (includeDeprecated = false) => llmRepository.loadUniqueProviders(includeDeprecated);
export const loadPresetOptions = (maxDescriptionLength?: number) =>
  configRepository.loadPresetOptions(maxDescriptionLength);
export const loadPresetOptionsByLocale = (locale: string, maxDescriptionLength?: number) =>
  configRepository.loadPresetOptionsByLocale(locale, maxDescriptionLength);
export const loadPresetRowsByLocale = (locale: string) => configRepository.loadPresetRowsByLocale(locale);
export const loadAllPresets = () => configRepository.loadAllPresets();
export const loadSystemPromptPresets = () => configRepository.loadSystemPromptPresets();
export const loadServerStickers = (serverDiscId: string) => serverRepository.loadStickers(serverDiscId);
export const getDueReminders = () => serverRepository.getDueReminders();
export const getNextReminderTime = () => serverRepository.getNextReminderTime();
export const getReminderById = (reminderId: number) => serverRepository.getReminderById(reminderId);
export const getUserReminderCount = (userDiscordId: string) => serverRepository.getUserReminderCount(userDiscordId);
export const deleteReminderById = (reminderId: number) => serverRepository.deleteReminderById(reminderId);
export const getPendingRemindersForUser = (...args: Parameters<typeof serverRepository.getPendingRemindersForUser>) =>
  serverRepository.getPendingRemindersForUser(...args);
export const getBraveApiKeyStatus = (serverId: number) => toolRepository.getBraveApiKeyStatus(serverId);
export const getBlacklistedMemberIds = (serverId: number) => userRepository.getBlacklistedMemberIds(serverId);
export const getDueRandomTriggers = () => serverRepository.getDueTriggers();
export const getNextRandomTriggerTime = () => serverRepository.getNextTriggerTime();
export const getServerRandomTriggers = (serverId: number) => serverRepository.getServerTriggers(serverId);
export const getServerRandomTriggerCount = (serverId: number) => serverRepository.getServerTriggerCount(serverId);
export const getRandomTriggerByPersonaAndChannel = (
  ...args: Parameters<typeof serverRepository.getTriggerByPersonaAndChannel>
) => serverRepository.getTriggerByPersonaAndChannel(...args);
export const getChannelLlmOverride = (serverId: number, channelDiscId: string) =>
  llmRepository.getChannelLlmOverride(serverId, channelDiscId);
export const getAllChannelLlmOverridesForServer = (serverId: number) =>
  llmRepository.getAllChannelLlmOverrides(serverId);
export const loadPersonaLlmOverridesForServer = (serverId: number) => llmRepository.loadPersonaLlmOverrides(serverId);
export const loadSavedProviderConfigs = (serverId: number) => llmRepository.loadSavedProviderConfigs(serverId);
export const loadSavedProviderConfig = (serverId: number, provider: string) =>
  llmRepository.loadSavedProviderConfig(serverId, provider);
export const loadUserSavedProviderConfigs = (userId: number) => llmRepository.loadUserSavedProviderConfigs(userId);
export const loadUserSavedProviderConfig = (userId: number, provider: string) =>
  llmRepository.loadUserSavedProviderConfig(userId, provider);
export const loadOpenRouterModelRegistrationsForServer = (serverId: number) =>
  llmRepository.loadOpenRouterModelRegistrationsForServer(serverId);
export const loadOpenRouterModelRegistrationsForUser = (userId: number) =>
  llmRepository.loadOpenRouterModelRegistrationsForUser(userId);
export const loadOpenRouterEmbeddingModelRegistrationsForServer = (serverId: number) =>
  llmRepository.loadOpenRouterEmbeddingModelRegistrationsForServer(serverId);
export const loadOpenRouterEmbeddingModelRegistrationsForUser = (userId: number) =>
  llmRepository.loadOpenRouterEmbeddingModelRegistrationsForUser(userId);
export const loadOpenRouterImageModelRegistrationsForServer = (serverId: number) =>
  llmRepository.loadOpenRouterImageModelRegistrationsForServer(serverId);
export const loadOpenRouterImageModelRegistrationsForUser = (userId: number) =>
  llmRepository.loadOpenRouterImageModelRegistrationsForUser(userId);
export const loadOpenRouterVideoModelRegistrationsForServer = (serverId: number) =>
  llmRepository.loadOpenRouterVideoModelRegistrationsForServer(serverId);
export const loadOpenRouterVideoModelRegistrationsForUser = (userId: number) =>
  llmRepository.loadOpenRouterVideoModelRegistrationsForUser(userId);
export const loadScopedOpenRouterModels = (scope: OpenRouterModelScope, includeDeprecated = false) =>
  llmRepository.loadScopedOpenRouterModels(scope, includeDeprecated);
export const loadScopedOpenRouterEmbeddingModels = (scope: OpenRouterModelScope, includeDeprecated = false) =>
  llmRepository.loadScopedOpenRouterEmbeddingModels(scope, includeDeprecated);
export const loadScopedOpenRouterDiffusionModels = (scope: OpenRouterModelScope, includeDeprecated = false) =>
  llmRepository.loadScopedOpenRouterDiffusionModels(scope, includeDeprecated);
export const loadScopedOpenRouterVideoGenerationModels = (scope: OpenRouterModelScope, includeDeprecated = false) =>
  llmRepository.loadScopedOpenRouterVideoGenerationModels(scope, includeDeprecated);
export const loadCustomEndpointsForServer = (serverId: number) => llmRepository.loadCustomEndpointsForServer(serverId);
export const loadCustomEndpointsForUser = (userId: number) => llmRepository.loadCustomEndpointsForUser(userId);
export const loadCustomEndpointsByIds = (ids: number[]) => llmRepository.loadCustomEndpointsByIds(ids);
export const loadCustomEndpoint = (...args: Parameters<typeof llmRepository.loadCustomEndpoint>) =>
  llmRepository.loadCustomEndpoint(...args);

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
export const addReminder = (...args: Parameters<typeof serverRepository.addReminder>) =>
  serverRepository.addReminder(...args);
export const rescheduleReminder = (...args: Parameters<typeof serverRepository.rescheduleReminder>) =>
  serverRepository.rescheduleReminder(...args);
export const updateReminder = (...args: Parameters<typeof serverRepository.updateReminder>) =>
  serverRepository.updateReminder(...args);
export const insertRandomTrigger = (...args: Parameters<typeof serverRepository.insertTrigger>) =>
  serverRepository.insertTrigger(...args);
export const upsertRandomTrigger = (...args: Parameters<typeof serverRepository.upsertTrigger>) =>
  serverRepository.upsertTrigger(...args);
export const deleteRandomTrigger = (triggerId: number) => serverRepository.deleteTrigger(triggerId);
export const rescheduleRandomTrigger = (...args: Parameters<typeof serverRepository.rescheduleTrigger>) =>
  serverRepository.rescheduleTrigger(...args);
export const setChannelLlmOverride = (serverId: number, channelDiscId: string, llmId: number) =>
  llmRepository.setChannelLlmOverride(serverId, channelDiscId, llmId);
export const setPersonaLlmOverride = (tomoriId: number, llmId: number | null) =>
  llmRepository.setPersonaLlmOverride(tomoriId, llmId);
export const setFallbackLlms = (serverId: number, llmIds: number[]) => llmRepository.setFallbackLlms(serverId, llmIds);
export const setFallbackModelRefs = (serverId: number, refs: FallbackModelRef[]) =>
  llmRepository.setFallbackModelRefs(serverId, refs);
export const deleteChannelLlmOverride = (serverId: number, channelDiscId: string) =>
  llmRepository.deleteChannelLlmOverride(serverId, channelDiscId);
export const clearAllChannelLlmOverridesForServer = (serverId: number) =>
  llmRepository.clearAllChannelLlmOverrides(serverId);
export const clearAllPersonaLlmOverridesForServer = (serverId: number) =>
  llmRepository.clearAllPersonaLlmOverrides(serverId);
export const upsertSavedProviderConfig = (...args: Parameters<typeof llmRepository.upsertSavedProviderConfig>) =>
  llmRepository.upsertSavedProviderConfig(...args);
export const deleteSavedProviderConfig = (serverId: number, provider: string) =>
  llmRepository.deleteSavedProviderConfig(serverId, provider);
export const upsertUserSavedProviderConfig = (
  ...args: Parameters<typeof llmRepository.upsertUserSavedProviderConfig>
) => llmRepository.upsertUserSavedProviderConfig(...args);
export const deleteUserSavedProviderConfig = (userId: number, provider: string) =>
  llmRepository.deleteUserSavedProviderConfig(userId, provider);
export const upsertCustomEndpoint = (...args: Parameters<typeof llmRepository.upsertCustomEndpoint>) =>
  llmRepository.upsertCustomEndpoint(...args);
export const deleteCustomEndpoint = (...args: Parameters<typeof llmRepository.deleteCustomEndpoint>) =>
  llmRepository.deleteCustomEndpoint(...args);
export const upsertOpenRouterModelRegistration = (
  ...args: Parameters<typeof llmRepository.upsertOpenRouterModelRegistration>
) => llmRepository.upsertOpenRouterModelRegistration(...args);
export const deleteOpenRouterModelRegistration = (
  ...args: Parameters<typeof llmRepository.deleteOpenRouterModelRegistration>
) => llmRepository.deleteOpenRouterModelRegistration(...args);
export const upsertOpenRouterEmbeddingModelRegistration = (
  ...args: Parameters<typeof llmRepository.upsertOpenRouterEmbeddingModelRegistration>
) => llmRepository.upsertOpenRouterEmbeddingModelRegistration(...args);
export const deleteOpenRouterEmbeddingModelRegistration = (
  ...args: Parameters<typeof llmRepository.deleteOpenRouterEmbeddingModelRegistration>
) => llmRepository.deleteOpenRouterEmbeddingModelRegistration(...args);
export const upsertOpenRouterImageModelRegistration = (
  ...args: Parameters<typeof llmRepository.upsertOpenRouterImageModelRegistration>
) => llmRepository.upsertOpenRouterImageModelRegistration(...args);
export const deleteOpenRouterImageModelRegistration = (
  ...args: Parameters<typeof llmRepository.deleteOpenRouterImageModelRegistration>
) => llmRepository.deleteOpenRouterImageModelRegistration(...args);
export const upsertOpenRouterVideoModelRegistration = (
  ...args: Parameters<typeof llmRepository.upsertOpenRouterVideoModelRegistration>
) => llmRepository.upsertOpenRouterVideoModelRegistration(...args);
export const deleteOpenRouterVideoModelRegistration = (
  ...args: Parameters<typeof llmRepository.deleteOpenRouterVideoModelRegistration>
) => llmRepository.deleteOpenRouterVideoModelRegistration(...args);
export const restoreOverridesFromSnapshot = (...args: Parameters<typeof llmRepository.restoreOverridesFromSnapshot>) =>
  llmRepository.restoreOverridesFromSnapshot(...args);
export const cleanupDeadChannelOverrides = (serverId: number, validChannelIds: Set<string>) =>
  llmRepository.cleanupDeadChannelOverrides(serverId, validChannelIds);

export const exportPersonalData = (...args: Parameters<typeof importExportRepository.exportPersonalData>) =>
  importExportRepository.exportPersonalData(...args);
export const exportServerData = (serverDiscId: string, tomoriId?: number) =>
  importExportRepository.exportServerData(serverDiscId, tomoriId);
export const exportPersonaPersonalMemories = (userDiscId: string, personaLineageId: number) =>
  importExportRepository.exportPersonaPersonalMemories(userDiscId, personaLineageId);
export const exportGlobalPersonalMemories = (userDiscId: string) =>
  importExportRepository.exportGlobalPersonalMemories(userDiscId);
export const exportPersonalSettings = (userDiscId: string) => importExportRepository.exportPersonalSettings(userDiscId);
export const exportPersonaServerMemories = (serverDiscId: string, tomoriId: number) =>
  importExportRepository.exportPersonaServerMemories(serverDiscId, tomoriId);
export const exportServerConfig = (serverDiscId: string) => importExportRepository.exportServerConfig(serverDiscId);
export const exportPersonalityData = (serverDiscId: string, tomoriId?: number) =>
  importExportRepository.exportPersonalityData(serverDiscId, tomoriId);
export const importPersonalMemories = (...args: Parameters<typeof importExportRepository.importPersonalMemories>) =>
  importExportRepository.importPersonalMemories(...args);
export const importPersonalSettings = (...args: Parameters<typeof importExportRepository.importPersonalSettings>) =>
  importExportRepository.importPersonalSettings(...args);
export const importServerConfig = (serverDiscId: string, config: ServerConfigExport) =>
  importExportRepository.importServerConfig(serverDiscId, config);
export const importServerMemories = (...args: Parameters<typeof importExportRepository.importServerMemories>) =>
  importExportRepository.importServerMemories(...args);
export const importPersonalData = (...args: Parameters<typeof importExportRepository.importPersonalData>) =>
  importExportRepository.importPersonalData(...args);
export const importServerData = (...args: Parameters<typeof importExportRepository.importServerData>) =>
  importExportRepository.importServerData(...args);
export const validateImportFile = (jsonData: unknown) => importExportRepository.validateImportFile(jsonData);
