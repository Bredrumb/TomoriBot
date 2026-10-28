import { type ProviderRequestDeniedError, getProviderRequestFailureCopy } from "@/utils/provider/providerUsage";
import {
  type APIAttachment,
  type ButtonInteraction,
  ComponentType,
  MessageFlags,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
} from "discord.js";
import type { ServerMemoryRow, TomoriState } from "@/types/db/schema";
import type { PanelReadStatus, PanelReceipt } from "@/types/discord/panel";
import type { PanelAction } from "@/constants/panelActions";
import {
  clearShortTermMemoryForServerChannel,
  getShortTermMemoriesForServer,
  preWarmServerStmEntries,
} from "@/utils/cache/shortTermMemoryCache";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { getCachedUserRow } from "@/utils/cache/userCache";
import { personaRepository, serverMemoryRepository, serverRepository, userRepository } from "@/utils/db/repositories";
import { LOREBOOK_ENTRIES_PER_SCOPE_MAX, type LorebookEntryRow } from "@/modules/lorebooks/db/types";
import { lorebookRepository, type LorebookScopeReadResult } from "@/modules/lorebooks/db/repositories";
import {
  LOREBOOK_IMPORT_MAX_FILE_MB,
  type LorebookUploadParseResult,
  parseLorebookUpload,
} from "@/modules/lorebooks/imports";
import { lorebookOperations, type LorebookOperations } from "@/modules/lorebooks/discord/operations";
import {
  LOREBOOK_ENTRY_PAGE_SIZE,
  buildAddLorebookModal,
  buildEditLorebookModal,
  buildImportLorebookModal,
  buildLorebookActivationModal,
  buildLorebookModalFieldId,
  parseLorebookInteger,
  parseLorebookKeys,
  parseLorebookPlacement,
  parseLorebookSelectiveLogic,
} from "@/modules/lorebooks/discord/panelSection";
import { safeDownload } from "@/utils/security/safeDownload";
import type { GlobalInteractionRoute, GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import {
  beginPanelInteraction,
  deliverGuardedPanel,
  performPanelAction,
  validateAndFallbackPanelPayload,
} from "@/utils/discord/interactions/panelController";
import {
  MEMORIES_ROUTE_NAMESPACE,
  MEMORIES_ROUTE_VERSION,
  computeServerStmFingerprint,
  parseMemoriesPanelRoute,
  type MemoriesCategory,
} from "@/utils/discord/memoriesPanelCatalog";
import {
  buildAddDocumentModal,
  buildAddServerMemoryModal,
  buildEditDocumentChunkModal,
  buildEditServerMemoryModal,
  buildMemoriesPanelPayload,
  buildServerStmModal,
  buildServerMemoryModalFieldId,
  buildDocumentModalFieldId,
  buildStmCheckboxFieldId,
  buildVectorizeMemoryModal,
  MAX_STM_MANAGEABLE_ENTRIES,
  MAX_STM_OPTIONS_PER_GROUP,
  MAX_DOCUMENT_PAGE_SIZE,
  MAX_SERVER_MEMORY_PAGE_SIZE,
  type MemoriesPanelPayload,
  type StmPanelEntry,
} from "@/utils/discord/ui/memoriesPanel";
import { personaRepresentativeForLineage } from "@/utils/persona/lineage";
import {
  type PersonaPanelAvatarData,
  resolvePersonaPanelAvatar,
  withPersonaPanelAvatar,
} from "@/utils/discord/personaPanelAvatar";
import { buildPanelContainer } from "@/utils/discord/ui/panel";
import {
  showRoutedRawModal,
  takeRawModalChannelSelectValues,
  takeRawModalCheckboxGroupValues,
  takeRawModalFileUpload,
  takeRawModalStringSelectValues,
} from "@/utils/discord/ui/modals";
import { createNonce } from "@/utils/discord/panelRouteTokens";
import {
  dedupeCaseInsensitive,
  getNonEmptyNumberedLines,
  readTxtUpload,
  type TxtUploadReadResult,
} from "@/utils/teach/batchUploadUtils";
import { getMemoryLimits, validateMemoryContent } from "@/utils/misc/memoryLimits";
import { recordPanelActionStat } from "@/utils/stats/panelActionMetrics";
import { log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import {
  serverDocumentsOperations,
  type DocumentChunkRow,
  type DocumentListRow,
} from "@/utils/discord/interactions/memoriesDocumentOperations";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

function rangeIndexAfterRemoval<T>(
  records: readonly T[],
  removedId: number,
  getId: (record: T) => number,
  remainingCount: number,
  pageSize: number,
): number | undefined {
  const removedIndex = records.findIndex((record) => getId(record) === removedId);
  if (removedIndex < 0) return undefined;
  return Math.min(Math.floor(removedIndex / pageSize), Math.max(0, Math.ceil(remainingCount / pageSize) - 1));
}

interface MemoriesScope {
  serverId: number;
  workspaceId: string;
  guildId: string | null;
  userDiscId: string;
  userId: number;
  canManage: boolean;
  isBlacklisted: boolean;
  memteachingEnabled: boolean;
  configuredEmbeddingModelId: number | null;
  personas: TomoriState[];
  readStatus: PanelReadStatus;
}

interface ServerMemoryAddInput {
  serverId: number;
  personaId: number;
  personaLineageId: number;
  taughtByUserId: number;
  workspaceId: string;
  isBlacklisted: boolean;
  canManage: boolean;
  memteachingEnabled: boolean;
  content: string;
  channelDiscIds: string[];
}

interface ServerMemoryAddBatchInput {
  serverId: number;
  personaId: number;
  personaLineageId: number;
  taughtByUserId: number;
  workspaceId: string;
  isBlacklisted: boolean;
  canManage: boolean;
  memteachingEnabled: boolean;
  contents: string[];
  channelDiscIds: string[];
}

interface ServerMemoryEditInput {
  serverId: number;
  personaLineageId: number;
  taughtByUserId: number;
  memoryId: number;
  workspaceId: string;
  isBlacklisted: boolean;
  canManage: boolean;
  memteachingEnabled: boolean;
  content: string;
  channelDiscIds: string[];
}

interface ServerMemoryRemoveInput {
  serverId: number;
  personaLineageId: number;
  taughtByUserId: number;
  memoryId: number;
  workspaceId: string;
  isBlacklisted: boolean;
  canManage: boolean;
  memteachingEnabled: boolean;
}

type ServerMemoryAddResult =
  | { status: "blacklisted" }
  | { status: "teaching-disabled" }
  | { status: "empty-content" }
  | { status: "content-too-long" }
  | { status: "limit-reached" }
  | { status: "write-failed" }
  | { status: "success"; row: ServerMemoryRow };

type ServerMemoryAddBatchResult =
  | { status: "blacklisted" }
  | { status: "teaching-disabled" }
  | { status: "empty-content" }
  | { status: "content-too-long" }
  | { status: "all-duplicates" }
  | { status: "batch-limit-reached"; available: number; requested: number }
  | { status: "write-failed" }
  | { status: "success"; added: number; skipped: number };

type ServerMemoryEditResult =
  | { status: "blacklisted" }
  | { status: "teaching-disabled" }
  | { status: "empty-content" }
  | { status: "content-too-long" }
  | { status: "not-found" }
  | { status: "unchanged"; row: ServerMemoryRow }
  | { status: "write-failed" }
  | { status: "success"; row: ServerMemoryRow };

type ServerMemoryRemoveResult =
  | { status: "blacklisted" }
  | { status: "teaching-disabled" }
  | { status: "not-found" }
  | { status: "write-failed" }
  | { status: "success"; row: ServerMemoryRow };

export interface ServerMemoriesOperations {
  add(input: ServerMemoryAddInput): Promise<ServerMemoryAddResult>;
  addBatch(input: ServerMemoryAddBatchInput): Promise<ServerMemoryAddBatchResult>;
  edit(input: ServerMemoryEditInput): Promise<ServerMemoryEditResult>;
  remove(input: ServerMemoryRemoveInput): Promise<ServerMemoryRemoveResult>;
}

export const serverMemoriesOperations: ServerMemoriesOperations = {
  async add({
    serverId,
    personaId,
    personaLineageId,
    taughtByUserId,
    workspaceId,
    isBlacklisted,
    canManage,
    memteachingEnabled,
    content,
    channelDiscIds,
  }) {
    if (isBlacklisted && !canManage) {
      return { status: "blacklisted" };
    }
    if (!memteachingEnabled && !canManage) {
      return { status: "teaching-disabled" };
    }
    const trimmed = content.trim();
    if (!trimmed) {
      return { status: "empty-content" };
    }
    const validation = validateMemoryContent(trimmed);
    if (!validation.isValid) {
      return { status: "content-too-long" };
    }
    const limitCheck = await serverMemoryRepository.checkServerMemoryLimit(serverId, personaLineageId);
    if (!limitCheck.isValid) {
      return { status: "limit-reached" };
    }
    const inserted = await serverMemoryRepository.add(
      serverId,
      personaId,
      personaLineageId,
      taughtByUserId,
      trimmed,
      workspaceId,
      channelDiscIds,
    );
    if (!inserted) {
      return { status: "write-failed" };
    }
    return { status: "success", row: inserted };
  },

  async addBatch({
    serverId,
    personaId,
    personaLineageId,
    taughtByUserId,
    workspaceId,
    isBlacklisted,
    canManage,
    memteachingEnabled,
    contents,
    channelDiscIds,
  }) {
    if (isBlacklisted && !canManage) {
      return { status: "blacklisted" };
    }
    if (!memteachingEnabled && !canManage) {
      return { status: "teaching-disabled" };
    }

    const trimmed = dedupeCaseInsensitive(contents.map((entry) => entry.trim()).filter((entry) => entry.length > 0));
    if (trimmed.length === 0) {
      return { status: "empty-content" };
    }
    if (trimmed.some((entry) => !validateMemoryContent(entry).isValid)) {
      return { status: "content-too-long" };
    }

    const existing = await serverMemoryRepository.loadServerMemoryContents(serverId, personaLineageId);
    const existingContents = new Set(existing.map((c) => c.trim().toLowerCase()));
    const toInsert = trimmed.filter((entry) => !existingContents.has(entry.toLowerCase()));
    if (toInsert.length === 0) {
      return { status: "all-duplicates" };
    }

    const limitCheck = await serverMemoryRepository.checkServerMemoryLimit(serverId, personaLineageId);
    const currentCount = limitCheck.currentCount ?? existing.length;
    const maxAllowed = limitCheck.maxAllowed ?? getMemoryLimits().maxServerMemories;
    const available = Math.max(0, maxAllowed - currentCount);
    if (toInsert.length > available) {
      return { status: "batch-limit-reached", available, requested: toInsert.length };
    }

    const ok = await serverMemoryRepository.addBatch(
      serverId,
      personaId,
      personaLineageId,
      taughtByUserId,
      toInsert,
      channelDiscIds,
    );
    if (!ok) {
      return { status: "write-failed" };
    }
    invalidateTomoriStateCache(workspaceId);
    return { status: "success", added: toInsert.length, skipped: trimmed.length - toInsert.length };
  },

  async edit({
    serverId,
    personaLineageId,
    taughtByUserId,
    memoryId,
    workspaceId,
    isBlacklisted,
    canManage,
    memteachingEnabled,
    content,
    channelDiscIds,
  }) {
    if (isBlacklisted && !canManage) {
      return { status: "blacklisted" };
    }
    if (!memteachingEnabled && !canManage) {
      return { status: "teaching-disabled" };
    }
    const trimmed = content.trim();
    if (!trimmed) {
      return { status: "empty-content" };
    }
    const validation = validateMemoryContent(trimmed);
    if (!validation.isValid) {
      return { status: "content-too-long" };
    }
    const ownerFilter = canManage ? undefined : taughtByUserId;
    const freshlyLoaded = await serverMemoryRepository.loadServerMemoriesScoped(
      serverId,
      personaLineageId,
      ownerFilter,
    );
    const target = freshlyLoaded.find((m) => m.server_memory_id === memoryId);
    if (!target) {
      return { status: "not-found" };
    }
    const existingScope = new Set(target.channel_disc_ids);
    const scopeUnchanged =
      channelDiscIds.length === existingScope.size && channelDiscIds.every((id) => existingScope.has(id));
    if (trimmed === target.content.trim() && scopeUnchanged && !target.channel_scope_pending) {
      return { status: "unchanged", row: target };
    }
    const ok = await serverMemoryRepository.edit(memoryId, trimmed, channelDiscIds);
    if (!ok) {
      return { status: "write-failed" };
    }
    invalidateTomoriStateCache(workspaceId);
    return {
      status: "success",
      row: { ...target, content: trimmed, channel_disc_ids: channelDiscIds, channel_scope_pending: false },
    };
  },

  async remove({
    serverId,
    personaLineageId,
    taughtByUserId,
    memoryId,
    workspaceId,
    isBlacklisted,
    canManage,
    memteachingEnabled,
  }) {
    if (isBlacklisted && !canManage) {
      return { status: "blacklisted" };
    }
    if (!memteachingEnabled && !canManage) {
      return { status: "teaching-disabled" };
    }
    const ownerFilter = canManage ? undefined : taughtByUserId;
    const freshlyLoaded = await serverMemoryRepository.loadServerMemoriesScoped(
      serverId,
      personaLineageId,
      ownerFilter,
    );
    const target = freshlyLoaded.find((m) => m.server_memory_id === memoryId);
    if (!target) {
      return { status: "not-found" };
    }
    const ok = await serverMemoryRepository.remove(memoryId);
    if (!ok) {
      return { status: "write-failed" };
    }
    invalidateTomoriStateCache(workspaceId);
    return { status: "success", row: target };
  },
};

export interface MemoriesRouteDependencies {
  resolveScope(
    interaction: GlobalRoutableInteraction | ChatInputCommandInteraction,
    forceRefresh?: boolean,
  ): Promise<MemoriesScope | null>;
  loadMemories(serverId: number, lineageId: number, userId?: number): Promise<ServerMemoryRow[]>;
  getMemoryCountsByLineage(serverId: number, userId?: number): Promise<Map<number, number>>;
  getPersonaAvatarData(
    interaction: GlobalRoutableInteraction | ChatInputCommandInteraction,
    persona: TomoriState,
  ): Promise<PersonaPanelAvatarData>;
  loadDocuments(serverId: number, personaId: number | null): Promise<DocumentListRow[]>;
  loadDocumentMeta(
    serverId: number,
    personaId: number | null,
    documentId: number,
  ): Promise<{ document_name: string; channel_disc_ids: string[]; channel_scope_pending: boolean } | null>;
  loadDocumentChunks(serverId: number, personaId: number | null, documentId: number): Promise<DocumentChunkRow[]>;
  getDocumentCounts(serverId: number, personaId: number | null): Promise<{ documents: number; chunks: number }>;
  getDocumentCountsByPersona(serverId: number): Promise<{ byPersona: Map<number, number>; serverwide: number }>;
  getEligibleHistoryPersonaIds(serverId: number): Promise<Set<number>>;
  loadLorebooks(serverId: number, lineageId: number | null): Promise<LorebookScopeReadResult>;
  getLorebookCounts(serverId: number): Promise<Map<number | null, number> | null>;
  lorebookOperations: LorebookOperations;
  getStmEntries(workspaceId: string, personas: TomoriState[], locale: string): Promise<StmPanelEntry[]>;
  preWarmServerStm(workspaceId: string): Promise<void>;
  operations: ServerMemoriesOperations;
  documentOperations: typeof serverDocumentsOperations;
  recordAction(input: { action: PanelAction; serverId: number; userDiscId: string }): void;
  createNonce(): string;
  showAddModal(
    interaction: StringSelectMenuInteraction | ButtonInteraction,
    locale: string,
    lineageId: number,
    nonce: string,
  ): Promise<void>;
  takeFileUpload(interactionId: string, nonce: string): APIAttachment | undefined;
  takeDocumentFileUpload(interactionId: string, nonce: string): APIAttachment | undefined;
  readUploadedText(attachment: APIAttachment): Promise<TxtUploadReadResult>;
  showEditModal(
    interaction: ButtonInteraction,
    locale: string,
    lineageId: number,
    memory: ServerMemoryRow,
    nonce: string,
  ): Promise<void>;
  showAddDocumentModal(
    interaction: StringSelectMenuInteraction | ButtonInteraction,
    locale: string,
    personaId: number,
    nonce: string,
  ): Promise<void>;
  showEditChunkModal(
    interaction: ButtonInteraction,
    locale: string,
    personaId: number,
    documentId: number,
    chunk: DocumentChunkRow,
    channelDiscIds: string[],
    nonce: string,
  ): Promise<void>;
  showVectorizeModal(
    interaction: ButtonInteraction,
    locale: string,
    lineageId: number,
    personaId: number,
    memory: ServerMemoryRow,
    nonce: string,
  ): Promise<void>;
  showStmModal(
    interaction: ButtonInteraction,
    locale: string,
    entries: StmPanelEntry[],
    fingerprint: string,
  ): Promise<void>;
  showAddLorebookModal(
    interaction: StringSelectMenuInteraction | ButtonInteraction,
    locale: string,
    scopeLineageId: number,
    nonce: string,
  ): Promise<void>;
  showImportLorebookModal(
    interaction: StringSelectMenuInteraction | ButtonInteraction,
    locale: string,
    scopeLineageId: number,
    nonce: string,
  ): Promise<void>;
  showEditLorebookModal(
    interaction: ButtonInteraction,
    locale: string,
    scopeLineageId: number,
    entry: LorebookEntryRow,
    nonce: string,
  ): Promise<void>;
  showLorebookActivationModal(
    interaction: ButtonInteraction,
    locale: string,
    scopeLineageId: number,
    entry: LorebookEntryRow,
    nonce: string,
  ): Promise<void>;
  takeLorebookFileUpload(interactionId: string, nonce: string): APIAttachment | undefined;
  parseLorebookUpload(buffer: Uint8Array): LorebookUploadParseResult;
  filterChannelScope(interaction: GlobalRoutableInteraction, channelIds: string[]): Promise<string[]>;
  takeCheckboxValues(interactionId: string, fieldId: string): string[] | undefined;
  takeStringSelectValues(interactionId: string, fieldId: string): string[] | undefined;
  takeChannelSelectValues(interactionId: string, fieldId: string): string[] | undefined;
  clearStm(workspaceId: string, channelId: string, personaId: number | null): void;
}

const RECEIPT_LOCALE_KEYS = {
  added: {
    heading: "commands.memories.added_heading",
    detail: "commands.memories.added_detail",
  },
  edited: {
    heading: "commands.memories.edited_heading",
    detail: "commands.memories.edited_detail",
  },
  removed: {
    heading: "commands.memories.removed_heading",
    detail: "commands.memories.removed_detail",
  },
  no_changes: {
    heading: "commands.memories.no_changes_heading",
    detail: "commands.memories.no_changes_detail",
  },
  changed_state: {
    heading: "commands.memories.changed_state_heading",
    detail: "commands.memories.changed_state_detail",
  },
  write_failed: {
    heading: "commands.memories.write_failed_heading",
    detail: "commands.memories.write_failed_detail",
  },
  content_too_long: {
    heading: "commands.memories.content_too_long_heading",
    detail: "commands.memories.content_too_long_detail",
  },
  limit_reached: {
    heading: "commands.memories.limit_reached_heading",
    detail: "commands.memories.limit_reached_detail",
  },
  empty_content: {
    heading: "commands.memories.empty_content_heading",
    detail: "commands.memories.empty_content_detail",
  },
  batch_added: {
    heading: "commands.memories.batch_added_heading",
    detail: "commands.memories.batch_added_detail",
  },
  batch_file_invalid: {
    heading: "commands.memories.batch_file_invalid_heading",
    detail: "commands.memories.batch_file_invalid_detail",
  },
  batch_file_too_large: {
    heading: "commands.memories.batch_file_too_large_heading",
    detail: "commands.memories.batch_file_too_large_detail",
  },
  batch_all_duplicates: {
    heading: "commands.memories.batch_all_duplicates_heading",
    detail: "commands.memories.batch_all_duplicates_detail",
  },
  batch_limit_reached: {
    heading: "commands.memories.batch_limit_reached_heading",
    detail: "commands.memories.batch_limit_reached_detail",
  },
  blacklisted_error: {
    heading: "commands.memories.blacklisted_error_heading",
    detail: "commands.memories.blacklisted_error_detail",
  },
  teaching_disabled_error: {
    heading: "commands.memories.teaching_disabled_error_heading",
    detail: "commands.memories.teaching_disabled_error_detail",
  },
  manager_only: {
    heading: "commands.memories.manager_only_heading",
    detail: "commands.memories.manager_only_detail",
  },
  document_added: {
    heading: "commands.memories.document_added_heading",
    detail: "commands.memories.document_added_detail",
  },
  document_removed: {
    heading: "commands.memories.document_removed_heading",
    detail: "commands.memories.document_removed_detail",
  },
  document_chunk_edited: {
    heading: "commands.memories.document_chunk_edited_heading",
    detail: "commands.memories.document_chunk_edited_detail",
  },
  document_chunk_removed: {
    heading: "commands.memories.document_chunk_removed_heading",
    detail: "commands.memories.document_chunk_removed_detail",
  },
  document_removed_with_last_chunk: {
    heading: "commands.memories.document_removed_with_last_chunk_heading",
    detail: "commands.memories.document_removed_with_last_chunk_detail",
  },
  vectorized: {
    heading: "commands.memories.vectorized_heading",
    detail: "commands.memories.vectorized_detail",
  },
  vectorize_partial_failure: {
    heading: "commands.memories.vectorize_partial_failure_heading",
    detail: "commands.memories.vectorize_partial_failure_detail",
  },
  document_rag_disabled: {
    heading: "commands.memories.document_rag_disabled_heading",
    detail: "commands.memories.document_rag_disabled_detail",
  },
  document_memory_critical: {
    heading: "commands.memories.document_memory_critical_heading",
    detail: "commands.memories.document_memory_critical_detail",
  },
  document_invalid_name: {
    heading: "commands.memories.document_invalid_name_heading",
    detail: "commands.memories.document_invalid_name_detail",
  },
  document_invalid_file: {
    heading: "commands.memories.document_invalid_file_heading",
    detail: "commands.memories.document_invalid_file_detail",
  },
  document_file_too_large: {
    heading: "commands.memories.document_file_too_large_heading",
    detail: "commands.memories.document_file_too_large_detail",
  },
  document_download_failed: {
    heading: "commands.memories.document_download_failed_heading",
    detail: "commands.memories.document_download_failed_detail",
  },
  document_empty_content: {
    heading: "commands.memories.document_empty_content_heading",
    detail: "commands.memories.document_empty_content_detail",
  },
  document_content_too_long: {
    heading: "commands.memories.document_content_too_long_heading",
    detail: "commands.memories.document_content_too_long_detail",
  },
  document_too_many_chunks: {
    heading: "commands.memories.document_too_many_chunks_heading",
    detail: "commands.memories.document_too_many_chunks_detail",
  },
  document_limit: {
    heading: "commands.memories.document_limit_heading",
    detail: "commands.memories.document_limit_detail",
  },
  document_chunk_limit: {
    heading: "commands.memories.document_chunk_limit_heading",
    detail: "commands.memories.document_chunk_limit_detail",
  },
  document_duplicate: {
    heading: "commands.memories.document_duplicate_heading",
    detail: "commands.memories.document_duplicate_detail",
  },
  document_quota: {
    heading: "commands.memories.document_quota_heading",
    detail: "commands.memories.document_quota_detail",
  },
  embedding_credentials_missing: {
    heading: "commands.memories.embedding_credentials_missing_heading",
    detail: "commands.memories.embedding_credentials_missing_detail",
  },
  embedding_model_missing: {
    heading: "commands.memories.embedding_model_missing_heading",
    detail: "commands.memories.embedding_model_missing_detail",
  },
  stm_changed_state: {
    heading: "commands.memories.stm_changed_state_heading",
    detail: "commands.memories.stm_changed_state_detail",
  },
  stm_cleared: {
    heading: "commands.memories.stm_cleared_heading",
    detail: "commands.memories.stm_cleared_detail",
  },
  lorebook_added: {
    heading: "commands.memories.lorebook_added_heading",
    detail: "commands.memories.lorebook_added_detail",
  },
  lorebook_edited: {
    heading: "commands.memories.lorebook_edited_heading",
    detail: "commands.memories.lorebook_edited_detail",
  },
  lorebook_activation_saved: {
    heading: "commands.memories.lorebook_activation_saved_heading",
    detail: "commands.memories.lorebook_activation_saved_detail",
  },
  lorebook_enabled: {
    heading: "commands.memories.lorebook_enabled_heading",
    detail: "commands.memories.lorebook_enabled_detail",
  },
  lorebook_disabled: {
    heading: "commands.memories.lorebook_disabled_heading",
    detail: "commands.memories.lorebook_disabled_detail",
  },
  lorebook_always_on: {
    heading: "commands.memories.lorebook_always_on_heading",
    detail: "commands.memories.lorebook_always_on_detail",
  },
  lorebook_keywords: {
    heading: "commands.memories.lorebook_keywords_heading",
    detail: "commands.memories.lorebook_keywords_detail",
  },
  lorebook_removed: {
    heading: "commands.memories.lorebook_removed_heading",
    detail: "commands.memories.lorebook_removed_detail",
  },
  lorebook_changed_state: {
    heading: "commands.memories.lorebook_changed_state_heading",
    detail: "commands.memories.lorebook_changed_state_detail",
  },
  lorebook_read_failed: {
    heading: "commands.memories.lorebook_read_failed_heading",
    detail: "commands.memories.lorebook_read_failed_detail",
  },
  lorebook_write_failed: {
    heading: "commands.memories.lorebook_write_failed_heading",
    detail: "commands.memories.lorebook_write_failed_detail",
  },
  lorebook_invalid_entry: {
    heading: "commands.memories.lorebook_invalid_entry_heading",
    detail: "commands.memories.lorebook_invalid_entry_detail",
  },
  lorebook_title_required: {
    heading: "commands.memories.lorebook_title_required_heading",
    detail: "commands.memories.lorebook_title_required_detail",
  },
  lorebook_content_required: {
    heading: "commands.memories.lorebook_content_required_heading",
    detail: "commands.memories.lorebook_content_required_detail",
  },
  lorebook_keys_required: {
    heading: "commands.memories.lorebook_keys_required_heading",
    detail: "commands.memories.lorebook_keys_required_detail",
  },
  lorebook_invalid_number: {
    heading: "commands.memories.lorebook_invalid_number_heading",
    detail: "commands.memories.lorebook_invalid_number_detail",
  },
  lorebook_invalid_selection: {
    heading: "commands.memories.lorebook_invalid_selection_heading",
    detail: "commands.memories.lorebook_invalid_selection_detail",
  },
  lorebook_channels_invalid: {
    heading: "commands.memories.lorebook_channels_invalid_heading",
    detail: "commands.memories.lorebook_channels_invalid_detail",
  },
  lorebook_limit_reached: {
    heading: "commands.memories.lorebook_limit_reached_heading",
    detail: "commands.memories.lorebook_limit_reached_detail",
  },
  lorebook_imported: {
    heading: "commands.memories.lorebook_imported_heading",
    detail: "commands.memories.lorebook_imported_detail",
  },
  lorebook_import_replaced: {
    heading: "commands.memories.lorebook_import_replaced_heading",
    detail: "commands.memories.lorebook_import_replaced_detail",
  },
  lorebook_import_empty: {
    heading: "commands.memories.lorebook_import_empty_heading",
    detail: "commands.memories.lorebook_import_empty_detail",
  },
  lorebook_import_unsupported: {
    heading: "commands.memories.lorebook_import_unsupported_heading",
    detail: "commands.memories.lorebook_import_unsupported_detail",
  },
  lorebook_invalid_json: {
    heading: "commands.memories.lorebook_invalid_json_heading",
    detail: "commands.memories.lorebook_invalid_json_detail",
  },
  lorebook_import_limit: {
    heading: "commands.memories.lorebook_import_limit_heading",
    detail: "commands.memories.lorebook_import_limit_detail",
  },
  lorebook_import_invalid: {
    heading: "commands.memories.lorebook_import_invalid_heading",
    detail: "commands.memories.lorebook_import_invalid_detail",
  },
  lorebook_import_too_large: {
    heading: "commands.memories.lorebook_import_too_large_heading",
    detail: "commands.memories.lorebook_import_too_large_detail",
  },
  lorebook_import_failed: {
    heading: "commands.memories.lorebook_import_failed_heading",
    detail: "commands.memories.lorebook_import_failed_detail",
  },
};

type MemoryReceiptKey = keyof typeof RECEIPT_LOCALE_KEYS;

export const MEMORIES_RECEIPT_KEYS = Object.keys(RECEIPT_LOCALE_KEYS) as MemoryReceiptKey[];

const ERROR_RECEIPT_KEYS = new Set<string>([
  "blacklisted_error",
  "teaching_disabled_error",
  "empty_content",
  "content_too_long",
  "limit_reached",
  "write_failed",
  "batch_file_invalid",
  "batch_file_too_large",
  "batch_all_duplicates",
  "batch_limit_reached",
  "manager_only",
  "document_invalid_name",
  "document_rag_disabled",
  "document_memory_critical",
  "document_invalid_file",
  "document_file_too_large",
  "document_download_failed",
  "document_empty_content",
  "document_content_too_long",
  "document_too_many_chunks",
  "document_limit",
  "document_chunk_limit",
  "document_duplicate",
  "document_quota",
  "embedding_credentials_missing",
  "embedding_model_missing",
  "vectorize_partial_failure",
  "stm_changed_state",
  "lorebook_read_failed",
  "lorebook_write_failed",
  "lorebook_invalid_entry",
  "lorebook_title_required",
  "lorebook_content_required",
  "lorebook_keys_required",
  "lorebook_invalid_number",
  "lorebook_invalid_selection",
  "lorebook_channels_invalid",
  "lorebook_limit_reached",
  "lorebook_import_empty",
  "lorebook_import_unsupported",
  "lorebook_invalid_json",
  "lorebook_import_limit",
  "lorebook_import_invalid",
  "lorebook_import_too_large",
  "lorebook_import_failed",
]);

function receipt(locale: string, key: MemoryReceiptKey, variables?: Record<string, string | number>): PanelReceipt {
  return {
    tone: ERROR_RECEIPT_KEYS.has(key) ? "error" : "success",
    heading: localizer(locale, RECEIPT_LOCALE_KEYS[key].heading),
    detail: localizer(locale, RECEIPT_LOCALE_KEYS[key].detail, variables),
  };
}

/**
 * Yellow interim receipt painted before an embedding call.
 *
 * Document upload and vectorize both wait on the embedding provider, and the panel is already
 * deferred by then, so without this the message sits unchanged for several seconds with nothing to
 * say the work started. This paint is overwritten by the real receipt when the operation returns.
 */
const WORKING_RECEIPT_KEYS: Record<"document_working" | "vectorize_working", { heading: string; detail: string }> = {
  document_working: {
    heading: "commands.memories.document_working_heading",
    detail: "commands.memories.document_working_detail",
  },
  vectorize_working: {
    heading: "commands.memories.vectorize_working_heading",
    detail: "commands.memories.vectorize_working_detail",
  },
};

function workingReceipt(locale: string, key: keyof typeof WORKING_RECEIPT_KEYS): PanelReceipt {
  return {
    tone: "warning",
    heading: localizer(locale, WORKING_RECEIPT_KEYS[key].heading),
    detail: localizer(locale, WORKING_RECEIPT_KEYS[key].detail),
  };
}

function changedStateReceipt(locale: string): PanelReceipt {
  return {
    tone: "info",
    heading: localizer(locale, "commands.memories.changed_state_heading"),
    detail: localizer(locale, "commands.memories.changed_state_detail"),
  };
}

function lorebookChangedReceipt(locale: string): PanelReceipt {
  return {
    tone: "info",
    heading: localizer(locale, "commands.memories.lorebook_changed_state_heading"),
    detail: localizer(locale, "commands.memories.lorebook_changed_state_detail"),
  };
}

function noChangesReceipt(locale: string): PanelReceipt {
  return {
    tone: "info",
    heading: localizer(locale, "commands.memories.no_changes_heading"),
    detail: localizer(locale, "commands.memories.no_changes_detail"),
  };
}

function terminalPayload(locale: string, key: string): InteractionEditReplyOptions {
  return validateAndFallbackPanelPayload(
    {
      components: [
        buildPanelContainer([
          {
            type: ComponentType.TextDisplay,
            content: localizer(locale, key),
          },
        ]),
      ],
      attachments: [],
      flags: MessageFlags.IsComponentsV2,
    },
    locale,
  );
}

/**
 * Reads a submitted channel scope. Outside a server the modal has no channel field, so the scope is empty.
 *
 * @returns `undefined` when the submission is missing or malformed, so the caller repaints instead of
 * clearing the stored scope; `[]` when the select was submitted empty
 */
function takeChannelScope(
  dependencies: Pick<MemoriesRouteDependencies, "takeChannelSelectValues">,
  interaction: Pick<ModalSubmitInteraction, "id" | "guildId">,
  fieldId: string,
): string[] | undefined {
  if (!interaction.guildId) return [];
  const channelIds = dependencies.takeChannelSelectValues(interaction.id, fieldId);
  if (!channelIds?.every((id) => DISCORD_SNOWFLAKE_PATTERN.test(id))) return undefined;
  return [...new Set(channelIds)];
}

/** The panel's 0 sentinel means Serverwide, which the repository stores as a NULL lineage. */
function lorebookLineageId(scopeLineageId: number): number | null {
  return scopeLineageId === 0 ? null : scopeLineageId;
}

function isValidLorebookScope(scope: MemoriesScope, scopeLineageId: number): boolean {
  return scopeLineageId === 0 || scope.personas.some((persona) => persona.persona_lineage_id === scopeLineageId);
}

/** Keeps only channels that belong to this guild, so a forged select value cannot widen or invent scope. */
async function filterGuildChannelScope(
  interaction: GlobalRoutableInteraction,
  channelIds: string[],
): Promise<string[]> {
  const guild = interaction.guild;
  if (!guild) return [];
  const valid: string[] = [];
  for (const channelId of channelIds) {
    if (!DISCORD_SNOWFLAKE_PATTERN.test(channelId)) continue;
    if (guild.channels.cache.has(channelId)) {
      valid.push(channelId);
      continue;
    }
    try {
      if ((await guild.channels.fetch(channelId)) !== null) valid.push(channelId);
    } catch {
      // Discord throws Unknown Channel for an id from another guild, and that id must not enter the scope.
    }
  }
  return valid;
}

/** Returns null when the submission is missing, malformed, or names a channel outside this guild. */
async function takeLorebookChannelScope(
  dependencies: Pick<MemoriesRouteDependencies, "takeChannelSelectValues" | "filterChannelScope">,
  interaction: ModalSubmitInteraction,
  nonce: string,
): Promise<string[] | null> {
  const submitted = takeChannelScope(dependencies, interaction, buildLorebookModalFieldId("channels", nonce));
  if (!submitted) return null;
  const valid = await dependencies.filterChannelScope(interaction, submitted);
  return valid.length === submitted.length ? valid : null;
}

/**
 * Receipt key for each non-success document operation status.
 *
 * Exported so a test can prove every value here is also in `MEMORIES_RECEIPT_KEYS`: a status
 * mapped to a key nobody registered renders the raw key to the user, and `check-locales` cannot
 * see it because the heading and detail suffixes are composed at call time.
 */
export const DOCUMENT_RESULT_RECEIPT_KEYS: Record<string, MemoryReceiptKey> = {
  blacklisted: "blacklisted_error",
  "teaching-disabled": "teaching_disabled_error",
  "rag-disabled": "document_rag_disabled",
  "memory-critical": "document_memory_critical",
  "invalid-name": "document_invalid_name",
  "invalid-file": "document_invalid_file",
  "file-too-large": "document_file_too_large",
  "download-failed": "document_download_failed",
  "empty-content": "document_empty_content",
  "content-too-long": "document_content_too_long",
  "too-many-chunks": "document_too_many_chunks",
  "document-limit": "document_limit",
  "chunk-limit": "document_chunk_limit",
  duplicate: "document_duplicate",
  "quota-exceeded": "document_quota",
  "credentials-missing": "embedding_credentials_missing",
  "model-missing": "embedding_model_missing",
  "write-failed": "write_failed",
  forbidden: "manager_only",
};

function documentResultReceipt(
  locale: string,
  result: { status: string; denied?: ProviderRequestDeniedError },
  variables?: Record<string, string | number>,
) {
  const status = result.status;
  if (result.denied) {
    const copy = getProviderRequestFailureCopy(result.denied, locale);
    return { tone: "error" as const, heading: localizer(locale, copy.titleKey), detail: copy.description };
  }
  if (status === "not-found") return changedStateReceipt(locale);
  if (status === "unchanged") return noChangesReceipt(locale);
  return receipt(locale, DOCUMENT_RESULT_RECEIPT_KEYS[status] ?? "write_failed", variables);
}

async function resolveScope(
  interaction: GlobalRoutableInteraction | ChatInputCommandInteraction,
  _forceRefresh = false,
): Promise<MemoriesScope | null> {
  const userDiscId = interaction.user.id;
  const workspaceId = interaction.guildId ?? interaction.user.id;
  try {
    const userRow = await getCachedUserRow(userDiscId);
    const registeredUser = userRow ?? (await userRepository.register(userDiscId, interaction.user.username));
    if (!registeredUser?.user_id) return null;

    const canManage = !interaction.guildId || (interaction.memberPermissions?.has("ManageGuild") ?? false);
    const isBlacklisted = interaction.guildId
      ? ((await userRepository.isBlacklisted(interaction.guildId, userDiscId)) ?? false)
      : false;

    // The state is required rather than optional. Reading the teaching flag as
    // `tomoriState?.config.server_memteaching_enabled ?? false` turns a cache miss into a
    // confident "teaching is disabled" on a server where it is enabled, and every legacy leaf
    // instead dereferences a non-null state, so a missing one means unavailable, not restricted.
    const tomoriState = await getCachedTomoriState(workspaceId);
    const internalServerId = tomoriState?.server_id ?? (await serverRepository.loadServerIdByDiscId(workspaceId));
    if (!internalServerId || !tomoriState) return null;

    const memteachingEnabled = tomoriState.config.server_memteaching_enabled;

    let personas: TomoriState[] = [];
    try {
      const allPersonas = await personaRepository.loadAllForServer(workspaceId);
      personas = allPersonas.filter(
        (p) => p.persona_lineage_id !== undefined && p.persona_lineage_id !== null && p.persona_lineage_id !== 0,
      );
    } catch (error) {
      log.warn("Failed to load personas for memories scope", { workspaceId, error });
    }

    return {
      serverId: internalServerId,
      workspaceId,
      guildId: interaction.guildId ?? null,
      userDiscId,
      userId: registeredUser.user_id,
      canManage,
      isBlacklisted,
      memteachingEnabled,
      configuredEmbeddingModelId: tomoriState.config.embedding_model_id ?? null,
      personas,
      readStatus: "fresh",
    };
  } catch (error) {
    log.error("Failed to resolve scope for memories", error);
    return null;
  }
}

async function loadMemories(serverId: number, lineageId: number, userId?: number): Promise<ServerMemoryRow[]> {
  return serverMemoryRepository.loadServerMemoriesScoped(serverId, lineageId, userId);
}

async function getMemoryCountsByLineage(serverId: number, userId?: number): Promise<Map<number, number>> {
  return serverMemoryRepository.memoryCountsByLineage(serverId, userId);
}

async function loadDocuments(serverId: number, personaId: number | null): Promise<DocumentListRow[]> {
  const [documents, history] = await Promise.all([
    serverMemoryRepository.loadDocuments(serverId, personaId),
    serverMemoryRepository.loadHistoryDocuments(serverId, personaId),
  ]);
  const historyIds = new Set(history.map((document) => document.document_id));
  return documents.map((document) => ({ ...document, isHistory: historyIds.has(document.document_id) }));
}

async function loadDocumentChunks(
  serverId: number,
  personaId: number | null,
  documentId: number,
): Promise<DocumentChunkRow[]> {
  return serverMemoryRepository.loadDocumentChunks(documentId, serverId, personaId);
}

async function loadDocumentMeta(serverId: number, personaId: number | null, documentId: number) {
  return serverMemoryRepository.loadDocumentMeta(documentId, serverId, personaId);
}

async function getDocumentCounts(
  serverId: number,
  personaId: number | null,
): Promise<{ documents: number; chunks: number }> {
  const [documents, chunks] = await Promise.all([
    serverMemoryRepository.countDocumentsScoped(serverId, personaId),
    serverMemoryRepository.countChunksScoped(serverId, personaId),
  ]);
  return { documents, chunks };
}

async function getStmEntries(workspaceId: string, personas: TomoriState[], locale: string): Promise<StmPanelEntry[]> {
  await preWarmServerStmEntries(workspaceId);
  const names = new Map<number, string>();
  for (const persona of personas) {
    if (persona.persona_id) names.set(persona.persona_id, persona.persona_nickname);
  }
  return getShortTermMemoriesForServer(workspaceId)
    .map((entry) => ({
      channelId: entry.channelId,
      channelName: entry.channelName,
      personaId: entry.personaId,
      personaName:
        entry.personaId == null
          ? localizer(locale, "commands.memories.stm_unscoped")
          : (names.get(entry.personaId) ?? localizer(locale, "commands.memories.persona_default_name")),
      summary: entry.summary,
      lastUpdated: entry.lastUpdated,
    }))
    .sort((left, right) => right.lastUpdated - left.lastUpdated);
}

async function preWarmServerStm(workspaceId: string): Promise<void> {
  await preWarmServerStmEntries(workspaceId);
}

/**
 * Refuse a modal-opening branch by repainting the panel with an error receipt.
 *
 * These branches sit above `beginPanelInteraction` because a modal is its own acknowledgement, so
 * they arrive unacknowledged. A refusal is not going to open a modal, which frees it to
 * `deferUpdate` and edit the panel in place; replying ephemerally instead posts a second, stray
 * message that reads as an unrelated error rather than as this panel's answer.
 */
async function refuseInPlace(
  interaction: GlobalRoutableInteraction,
  locale: string,
  scope: MemoriesScope | null,
  category: MemoriesCategory,
  selectedId: number,
  receiptKey: MemoryReceiptKey,
  dependencies: MemoriesRouteDependencies,
): Promise<void> {
  await interaction.deferUpdate();
  if (!scope) {
    await interaction.editReply(terminalPayload(locale, "commands.memories.unavailable"));
    return;
  }
  const memories =
    category === "memories" && selectedId
      ? await dependencies.loadMemories(scope.serverId, selectedId, scope.canManage ? undefined : scope.userId)
      : [];
  const page =
    category === "documents"
      ? { kind: "documents" as const }
      : category === "lorebooks"
        ? { kind: "lorebooks" as const }
        : { kind: "main" as const };
  const refusal =
    receiptKey === "changed_state"
      ? changedStateReceipt(locale)
      : receiptKey === "lorebook_changed_state"
        ? lorebookChangedReceipt(locale)
        : receipt(locale, receiptKey);
  await repaint(interaction, locale, scope, category, selectedId, memories, page, refusal, dependencies);
}

async function repaint(
  interaction: GlobalRoutableInteraction | ChatInputCommandInteraction,
  locale: string,
  scope: MemoriesScope,
  category: MemoriesCategory,
  selectedLineageId: number,
  memories: ServerMemoryRow[],
  page: Parameters<typeof buildMemoriesPanelPayload>[0]["page"],
  panelReceipt?: PanelReceipt,
  dependencies: MemoriesRouteDependencies = defaultDependencies,
): Promise<void> {
  const ownerFilter = scope.canManage ? undefined : scope.userId;
  let stmEntries: StmPanelEntry[] | undefined;
  if (category === "stm") {
    if (scope.canManage) {
      await dependencies.preWarmServerStm(scope.workspaceId);
      stmEntries = await dependencies.getStmEntries(scope.workspaceId, scope.personas, locale);
    }
  }

  let documents: DocumentListRow[] | undefined;
  let documentCount: number | undefined;
  let documentChunkCount: number | undefined;
  let documentChunks: DocumentChunkRow[] | undefined;
  let documentCountsByPersona: Map<number, number> | undefined;
  let eligibleHistoryPersonaIds: Set<number> | undefined;
  if (category === "documents" && (scope.canManage || scope.memteachingEnabled)) {
    const personaId = selectedLineageId === 0 ? null : selectedLineageId;
    let scopedCounts: { byPersona: Map<number, number>; serverwide: number };
    [documents, scopedCounts, eligibleHistoryPersonaIds] = await Promise.all([
      dependencies.loadDocuments(scope.serverId, personaId),
      dependencies.getDocumentCountsByPersona(scope.serverId),
      dependencies.getEligibleHistoryPersonaIds(scope.serverId),
    ]);
    documentCountsByPersona = scopedCounts.byPersona;
    const counts = await dependencies.getDocumentCounts(scope.serverId, personaId);
    documentCount = counts.documents;
    documentChunkCount = counts.chunks;
    const documentId =
      page.kind === "documents"
        ? page.selectedDocumentId
        : page.kind === "document-remove" || page.kind === "document-chunk-remove"
          ? page.documentId
          : undefined;
    const selectedDocumentId = documentId ?? documents[0]?.document_id;
    if (selectedDocumentId) {
      documentChunks = await dependencies.loadDocumentChunks(scope.serverId, personaId, selectedDocumentId);
    }
  }

  let lorebookEntries: LorebookEntryRow[] | undefined;
  let lorebookCounts: Map<number | null, number> | null = null;
  let readStatus = scope.readStatus;
  if (category === "lorebooks") {
    const [lorebooks, counts] = await Promise.all([
      dependencies.loadLorebooks(scope.serverId, lorebookLineageId(selectedLineageId)),
      dependencies.getLorebookCounts(scope.serverId),
    ]);
    lorebookCounts = counts;
    if (lorebooks.status === "unavailable") readStatus = "unavailable";
    else lorebookEntries = lorebooks.entries;
  }

  const memoryCountsByLineage =
    category === "memories" ? await dependencies.getMemoryCountsByLineage(scope.serverId, ownerFilter) : undefined;

  // Documents key on persona_id, so the face beside that heading is looked up directly rather
  // than through the lineage representative the Memories page uses. Serverwide (0) has none.
  const representative =
    category === "memories"
      ? personaRepresentativeForLineage(scope.personas, selectedLineageId)
      : category === "lorebooks" && selectedLineageId !== 0
        ? personaRepresentativeForLineage(scope.personas, selectedLineageId)
        : category === "documents" && selectedLineageId !== 0
          ? (scope.personas.find((persona) => persona.persona_id === selectedLineageId) ?? null)
          : null;
  const selectedPersonaAvatar = representative
    ? await dependencies.getPersonaAvatarData(interaction, representative)
    : undefined;

  await deliverGuardedPanel(
    interaction,
    withPersonaPanelAvatar(
      buildMemoriesPanelPayload({
        locale,
        category,
        selectedLineageId,
        personas: scope.personas,
        memoryCountsByLineage,
        selectedPersonaAvatarUrl: selectedPersonaAvatar?.url,
        memories,
        selectedDocumentPersonaId: category === "documents" ? selectedLineageId : undefined,
        documents,
        documentCount,
        documentChunkCount,
        documentChunks,
        documentCountsByPersona,
        eligibleHistoryPersonaIds,
        lorebookEntries,
        lorebookCounts,
        stmEntries,
        stmCount: stmEntries?.length,
        memteachingEnabled: scope.memteachingEnabled,
        canManage: scope.canManage,
        readStatus,
        page,
        receipt: panelReceipt,
      }),
      selectedPersonaAvatar,
    ),
    { locale, receipt: panelReceipt },
  );
}

const defaultDependencies: MemoriesRouteDependencies = {
  resolveScope,
  loadMemories,
  getMemoryCountsByLineage,
  getPersonaAvatarData: resolvePersonaPanelAvatar,
  loadDocuments,
  loadDocumentMeta,
  loadDocumentChunks,
  getDocumentCounts,
  getDocumentCountsByPersona: (serverId) => serverMemoryRepository.documentCountsByPersona(serverId),
  getEligibleHistoryPersonaIds: (serverId) => serverMemoryRepository.personaIdsWithHistoryDocuments(serverId),
  loadLorebooks: (serverId, lineageId) => lorebookRepository.listScope(serverId, lineageId),
  getLorebookCounts: (serverId) => lorebookRepository.countsByLineage(serverId),
  lorebookOperations,
  getStmEntries,
  preWarmServerStm,
  operations: serverMemoriesOperations,
  documentOperations: serverDocumentsOperations,
  recordAction: (input) => {
    void recordPanelActionStat(input);
  },
  createNonce,
  showAddModal: (interaction, locale, lineageId, nonce) =>
    showRoutedRawModal(
      interaction,
      buildAddServerMemoryModal(locale, lineageId, nonce, interaction.guildId ? [] : null),
    ),
  takeFileUpload: (interactionId, nonce) =>
    takeRawModalFileUpload(interactionId, buildServerMemoryModalFieldId("file", nonce)),
  takeDocumentFileUpload: (interactionId, nonce) =>
    takeRawModalFileUpload(interactionId, buildDocumentModalFieldId("file", nonce)),
  readUploadedText: readTxtUpload,
  showEditModal: (interaction, locale, lineageId, memory, nonce) =>
    showRoutedRawModal(
      interaction,
      buildEditServerMemoryModal(
        locale,
        lineageId,
        memory.server_memory_id ?? 0,
        memory.content,
        interaction.guildId ? memory.channel_disc_ids : null,
        nonce,
      ),
    ),
  showAddDocumentModal: (interaction, locale, personaId, nonce) =>
    showRoutedRawModal(interaction, buildAddDocumentModal(locale, personaId, nonce, interaction.guildId ? [] : null)),
  showEditChunkModal: (interaction, locale, personaId, documentId, chunk, channelDiscIds, nonce) =>
    showRoutedRawModal(
      interaction,
      buildEditDocumentChunkModal(
        locale,
        personaId,
        documentId,
        chunk.chunk_index,
        chunk.content,
        interaction.guildId ? channelDiscIds : null,
        nonce,
      ),
    ),
  showVectorizeModal: (interaction, locale, lineageId, personaId, memory, nonce) =>
    showRoutedRawModal(
      interaction,
      buildVectorizeMemoryModal(
        locale,
        lineageId,
        personaId,
        memory.server_memory_id ?? 0,
        memory.content,
        interaction.guildId ? memory.channel_disc_ids : null,
        nonce,
      ),
    ),
  showStmModal: (interaction, locale, entries, fingerprint) =>
    showRoutedRawModal(interaction, buildServerStmModal(locale, entries, fingerprint)),
  showAddLorebookModal: (interaction, locale, scopeLineageId, nonce) =>
    showRoutedRawModal(
      interaction,
      buildAddLorebookModal(locale, scopeLineageId, nonce, interaction.guildId ? [] : null),
    ),
  showImportLorebookModal: (interaction, locale, scopeLineageId, nonce) =>
    showRoutedRawModal(interaction, buildImportLorebookModal(locale, scopeLineageId, nonce)),
  showEditLorebookModal: async (interaction, locale, scopeLineageId, entry, nonce) => {
    const channelScope = interaction.guildId
      ? await filterGuildChannelScope(interaction, entry.channel_disc_ids)
      : null;
    await showRoutedRawModal(interaction, buildEditLorebookModal(locale, scopeLineageId, entry, nonce, channelScope));
  },
  showLorebookActivationModal: (interaction, locale, scopeLineageId, entry, nonce) =>
    showRoutedRawModal(interaction, buildLorebookActivationModal(locale, scopeLineageId, entry, nonce)),
  takeLorebookFileUpload: (interactionId, nonce) =>
    takeRawModalFileUpload(interactionId, buildLorebookModalFieldId("file", nonce)),
  parseLorebookUpload,
  filterChannelScope: filterGuildChannelScope,
  takeCheckboxValues: takeRawModalCheckboxGroupValues,
  takeStringSelectValues: takeRawModalStringSelectValues,
  takeChannelSelectValues: takeRawModalChannelSelectValues,
  clearStm: clearShortTermMemoryForServerChannel,
};

export async function buildInitialMemoriesPanel(
  interaction: GlobalRoutableInteraction | ChatInputCommandInteraction,
  locale: string,
  dependencies: MemoriesRouteDependencies = defaultDependencies,
  requestedLineageId?: number,
): Promise<MemoriesPanelPayload> {
  const scope = await dependencies.resolveScope(interaction);
  if (!scope) {
    return buildMemoriesPanelPayload({
      locale,
      category: "memories",
      selectedLineageId: 0,
      personas: [],
      memories: [],
      canManage: !interaction.guildId || (interaction.memberPermissions?.has("ManageGuild") ?? false),
      readStatus: "unavailable",
      page: { kind: "main" },
    });
  }

  const requestedPersona =
    requestedLineageId === undefined
      ? undefined
      : scope.personas.find((persona) => persona.persona_lineage_id === requestedLineageId);
  const selectedLineageId = requestedPersona?.persona_lineage_id ?? scope.personas[0]?.persona_lineage_id ?? 0;
  const ownerFilter = scope.canManage ? undefined : scope.userId;
  const memories = selectedLineageId
    ? await dependencies.loadMemories(scope.serverId, selectedLineageId, ownerFilter)
    : [];
  const memoryCountsByLineage = await dependencies.getMemoryCountsByLineage(scope.serverId, ownerFilter);
  const representative = personaRepresentativeForLineage(scope.personas, selectedLineageId);
  const selectedPersonaAvatar = representative
    ? await dependencies.getPersonaAvatarData(interaction, representative)
    : undefined;

  return withPersonaPanelAvatar(
    buildMemoriesPanelPayload({
      locale,
      category: "memories",
      selectedLineageId,
      personas: scope.personas,
      memoryCountsByLineage,
      selectedPersonaAvatarUrl: selectedPersonaAvatar?.url,
      memories,
      canManage: scope.canManage,
      readStatus: scope.readStatus,
      page: { kind: "main" },
    }),
    selectedPersonaAvatar,
  );
}

/**
 * Receipt key for each non-success lorebook write status.
 *
 * Exported so a test can prove every value is registered, the same guarantee the document map carries.
 */
export const LOREBOOK_RESULT_RECEIPT_KEYS: Record<string, MemoryReceiptKey> = {
  forbidden: "manager_only",
  limit: "lorebook_limit_reached",
  invalid: "lorebook_invalid_entry",
  failed: "lorebook_write_failed",
  "title-required": "lorebook_title_required",
  "content-required": "lorebook_content_required",
  "keys-required": "lorebook_keys_required",
  "channels-invalid": "lorebook_channels_invalid",
};

function lorebookResultReceipt(
  locale: string,
  status: string,
  variables?: Record<string, string | number>,
): PanelReceipt {
  if (status === "missing") return lorebookChangedReceipt(locale);
  return receipt(locale, LOREBOOK_RESULT_RECEIPT_KEYS[status] ?? "lorebook_write_failed", variables);
}

function readModalField(modal: ModalSubmitInteraction, fieldId: string): string | null {
  try {
    return modal.fields.getTextInputValue(fieldId);
  } catch {
    return null;
  }
}

async function guardLorebookWrite(
  interaction: GlobalRoutableInteraction,
  locale: string,
  scope: MemoriesScope,
  requestedScopeLineageId: number,
  dependencies: MemoriesRouteDependencies,
): Promise<{ ok: true; lineageId: number | null } | { ok: false }> {
  if (!isValidLorebookScope(scope, requestedScopeLineageId)) {
    await repaint(
      interaction,
      locale,
      scope,
      "lorebooks",
      0,
      [],
      { kind: "lorebooks" },
      lorebookChangedReceipt(locale),
      dependencies,
    );
    return { ok: false };
  }
  if (!scope.canManage) {
    await repaint(
      interaction,
      locale,
      scope,
      "lorebooks",
      requestedScopeLineageId,
      [],
      { kind: "lorebooks" },
      receipt(locale, "manager_only"),
      dependencies,
    );
    return { ok: false };
  }
  return { ok: true, lineageId: lorebookLineageId(requestedScopeLineageId) };
}

export function createMemoriesInteractionRoute(
  overrides: Partial<MemoriesRouteDependencies> = {},
): GlobalInteractionRoute {
  const dependencies: MemoriesRouteDependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  return {
    namespace: MEMORIES_ROUTE_NAMESPACE,
    version: MEMORIES_ROUTE_VERSION,
    async execute(_client, interaction, parsed): Promise<void> {
      const route = parseMemoriesPanelRoute(parsed);
      if (!route) throw new Error(`Malformed memories panel route: ${interaction.customId}`);

      // Modals and modal-opening select choices handle their own acknowledgement
      if (route.action === "select") {
        if (!interaction.isStringSelectMenu()) {
          throw new Error("Memories select route requires StringSelectMenu interaction");
        }
        const selectedValue = interaction.values[0];
        if (selectedValue === "action:add") {
          const cachedScope = await dependencies.resolveScope(interaction, false);
          if (!cachedScope) {
            await refuseInPlace(
              interaction,
              route.locale,
              null,
              "memories",
              route.lineageId,
              "write_failed",
              dependencies,
            );
            return;
          }
          if (cachedScope.isBlacklisted && !cachedScope.canManage) {
            await refuseInPlace(
              interaction,
              route.locale,
              cachedScope,
              "memories",
              route.lineageId,
              "blacklisted_error",
              dependencies,
            );
            return;
          }
          if (!cachedScope.memteachingEnabled && !cachedScope.canManage) {
            await refuseInPlace(
              interaction,
              route.locale,
              cachedScope,
              "memories",
              route.lineageId,
              "teaching_disabled_error",
              dependencies,
            );
            return;
          }
          const nonce = dependencies.createNonce();
          await dependencies.showAddModal(interaction, route.locale, route.lineageId, nonce);
          return;
        }
      }

      if (route.action === "edit-open") {
        if (!interaction.isButton()) {
          throw new Error("Memories edit-open route requires Button interaction");
        }
        const cachedScope = await dependencies.resolveScope(interaction, false);
        if (!cachedScope) {
          await refuseInPlace(
            interaction,
            route.locale,
            null,
            "memories",
            route.lineageId,
            "write_failed",
            dependencies,
          );
          return;
        }
        if (cachedScope.isBlacklisted && !cachedScope.canManage) {
          await refuseInPlace(
            interaction,
            route.locale,
            cachedScope,
            "memories",
            route.lineageId,
            "blacklisted_error",
            dependencies,
          );
          return;
        }
        const ownerFilter = cachedScope.canManage ? undefined : cachedScope.userId;
        const memories = await dependencies.loadMemories(cachedScope.serverId, route.lineageId, ownerFilter);
        const memory = memories.find((m) => m.server_memory_id === route.memoryId);
        if (!memory) {
          await interaction.deferUpdate();
          await repaint(
            interaction,
            route.locale,
            cachedScope,
            "memories",
            route.lineageId,
            memories,
            { kind: "main" },
            changedStateReceipt(route.locale),
            dependencies,
          );
          return;
        }
        const nonce = dependencies.createNonce();
        await dependencies.showEditModal(interaction, route.locale, route.lineageId, memory, nonce);
        return;
      }

      if (route.action === "lore-select" && interaction.isStringSelectMenu()) {
        const selectedValue = interaction.values[0];
        if (selectedValue === "action:add-lorebook" || selectedValue === "action:import-lorebook") {
          const cachedScope = await dependencies.resolveScope(interaction, false);
          if (!cachedScope) {
            await refuseInPlace(
              interaction,
              route.locale,
              null,
              "lorebooks",
              route.scopeLineageId,
              "write_failed",
              dependencies,
            );
            return;
          }
          if (!isValidLorebookScope(cachedScope, route.scopeLineageId)) {
            await refuseInPlace(
              interaction,
              route.locale,
              cachedScope,
              "lorebooks",
              0,
              "lorebook_changed_state",
              dependencies,
            );
            return;
          }
          if (!cachedScope.canManage) {
            await refuseInPlace(
              interaction,
              route.locale,
              cachedScope,
              "lorebooks",
              route.scopeLineageId,
              "manager_only",
              dependencies,
            );
            return;
          }
          const nonce = dependencies.createNonce();
          if (selectedValue === "action:add-lorebook") {
            await dependencies.showAddLorebookModal(interaction, route.locale, route.scopeLineageId, nonce);
          } else {
            await dependencies.showImportLorebookModal(interaction, route.locale, route.scopeLineageId, nonce);
          }
          return;
        }
      }

      if (route.action === "lore-edit-open" || route.action === "lore-activation-open") {
        if (!interaction.isButton()) throw new Error("Lorebook modal route requires Button interaction");
        const cachedScope = await dependencies.resolveScope(interaction, false);
        if (!cachedScope) {
          await refuseInPlace(
            interaction,
            route.locale,
            null,
            "lorebooks",
            route.scopeLineageId,
            "write_failed",
            dependencies,
          );
          return;
        }
        if (!isValidLorebookScope(cachedScope, route.scopeLineageId)) {
          await refuseInPlace(
            interaction,
            route.locale,
            cachedScope,
            "lorebooks",
            0,
            "lorebook_changed_state",
            dependencies,
          );
          return;
        }
        if (!cachedScope.canManage) {
          await refuseInPlace(
            interaction,
            route.locale,
            cachedScope,
            "lorebooks",
            route.scopeLineageId,
            "manager_only",
            dependencies,
          );
          return;
        }
        const lorebooks = await dependencies.loadLorebooks(
          cachedScope.serverId,
          lorebookLineageId(route.scopeLineageId),
        );
        const entry =
          lorebooks.status === "fresh"
            ? lorebooks.entries.find((candidate) => candidate.entry_id === route.entryId)
            : undefined;
        if (!entry) {
          await refuseInPlace(
            interaction,
            route.locale,
            cachedScope,
            "lorebooks",
            route.scopeLineageId,
            lorebooks.status === "fresh" ? "lorebook_changed_state" : "lorebook_read_failed",
            dependencies,
          );
          return;
        }
        const nonce = dependencies.createNonce();
        if (route.action === "lore-edit-open") {
          await dependencies.showEditLorebookModal(interaction, route.locale, route.scopeLineageId, entry, nonce);
        } else {
          await dependencies.showLorebookActivationModal(interaction, route.locale, route.scopeLineageId, entry, nonce);
        }
        return;
      }

      if (route.action === "document-select" && interaction.isStringSelectMenu()) {
        const selectedValue = interaction.values[0];
        if (selectedValue === "action:add-document") {
          const cachedScope = await dependencies.resolveScope(interaction, false);
          if (!cachedScope) {
            await refuseInPlace(
              interaction,
              route.locale,
              null,
              "documents",
              route.personaId,
              "write_failed",
              dependencies,
            );
            return;
          }
          if (!cachedScope.canManage && !cachedScope.memteachingEnabled) {
            await refuseInPlace(
              interaction,
              route.locale,
              cachedScope,
              "documents",
              route.personaId,
              "teaching_disabled_error",
              dependencies,
            );
            return;
          }
          if (cachedScope.isBlacklisted && !cachedScope.canManage) {
            await refuseInPlace(
              interaction,
              route.locale,
              cachedScope,
              "documents",
              route.personaId,
              "blacklisted_error",
              dependencies,
            );
            return;
          }
          if (
            route.personaId !== 0 &&
            !cachedScope.personas.some((persona) => persona.persona_id === route.personaId)
          ) {
            await refuseInPlace(
              interaction,
              route.locale,
              cachedScope,
              "documents",
              route.personaId,
              "changed_state",
              dependencies,
            );
            return;
          }
          await dependencies.showAddDocumentModal(
            interaction,
            route.locale,
            route.personaId,
            dependencies.createNonce(),
          );
          return;
        }
      }

      if (route.action === "document-chunk-edit-open") {
        if (!interaction.isButton()) throw new Error("Document chunk edit route requires Button interaction");
        const cachedScope = await dependencies.resolveScope(interaction, false);
        if (!cachedScope?.canManage) {
          await refuseInPlace(
            interaction,
            route.locale,
            cachedScope,
            "documents",
            route.personaId,
            "manager_only",
            dependencies,
          );
          return;
        }
        const personaId = route.personaId === 0 ? null : route.personaId;
        const [meta, chunks] = await Promise.all([
          dependencies.loadDocumentMeta(cachedScope.serverId, personaId, route.documentId),
          dependencies.loadDocumentChunks(cachedScope.serverId, personaId, route.documentId),
        ]);
        const chunk = chunks.find((candidate) => candidate.chunk_index === route.chunkIdx);
        if (!meta || !chunk || chunk.content.length > 4000) {
          await refuseInPlace(
            interaction,
            route.locale,
            cachedScope,
            "documents",
            route.personaId,
            "changed_state",
            dependencies,
          );
          return;
        }
        await dependencies.showEditChunkModal(
          interaction,
          route.locale,
          route.personaId,
          route.documentId,
          chunk,
          meta.channel_disc_ids,
          dependencies.createNonce(),
        );
        return;
      }

      if (route.action === "vectorize-confirm") {
        if (!interaction.isButton()) throw new Error("Vectorize confirm route requires Button interaction");
        const cachedScope = await dependencies.resolveScope(interaction, false);
        if (!cachedScope) {
          await refuseInPlace(
            interaction,
            route.locale,
            null,
            "memories",
            route.lineageId,
            "write_failed",
            dependencies,
          );
          return;
        }
        if (cachedScope.isBlacklisted && !cachedScope.canManage) {
          await refuseInPlace(
            interaction,
            route.locale,
            cachedScope,
            "memories",
            route.lineageId,
            "blacklisted_error",
            dependencies,
          );
          return;
        }
        if (!cachedScope.memteachingEnabled && !cachedScope.canManage) {
          await refuseInPlace(
            interaction,
            route.locale,
            cachedScope,
            "memories",
            route.lineageId,
            "teaching_disabled_error",
            dependencies,
          );
          return;
        }
        const representativeMatches = cachedScope.personas.some(
          (persona) => persona.persona_id === route.personaId && persona.persona_lineage_id === route.lineageId,
        );
        const owner = cachedScope.canManage ? undefined : cachedScope.userId;
        const memories = representativeMatches
          ? await dependencies.loadMemories(cachedScope.serverId, route.lineageId, owner)
          : [];
        const memory = memories.find((candidate) => candidate.server_memory_id === route.memoryId);
        if (!memory) {
          await refuseInPlace(
            interaction,
            route.locale,
            cachedScope,
            "memories",
            route.lineageId,
            "changed_state",
            dependencies,
          );
          return;
        }
        await dependencies.showVectorizeModal(
          interaction,
          route.locale,
          route.lineageId,
          route.personaId,
          memory,
          dependencies.createNonce(),
        );
        return;
      }

      if (route.action === "stm-open") {
        if (!interaction.isButton()) throw new Error("STM manage route requires Button interaction");
        const cachedScope = await dependencies.resolveScope(interaction, false);
        if (!cachedScope?.canManage) {
          await refuseInPlace(interaction, route.locale, cachedScope, "stm", 0, "manager_only", dependencies);
          return;
        }
        await dependencies.preWarmServerStm(cachedScope.workspaceId);
        const entries = await dependencies.getStmEntries(cachedScope.workspaceId, cachedScope.personas, route.locale);
        // Repaint rather than reply: the Short-Term page already states the active count and the
        // ceiling, so the refreshed page is a better answer than a second, stray message.
        if (entries.length === 0 || entries.length > MAX_STM_MANAGEABLE_ENTRIES) {
          await interaction.deferUpdate();
          await repaint(
            interaction,
            route.locale,
            cachedScope,
            "stm",
            0,
            [],
            { kind: "main" },
            undefined,
            dependencies,
          );
          return;
        }
        const fingerprint = computeServerStmFingerprint(cachedScope.workspaceId, cachedScope.userDiscId, entries);
        await dependencies.showStmModal(interaction, route.locale, entries, fingerprint);
        return;
      }

      const initialScope = await beginPanelInteraction(interaction, {
        authorize: () => true,
        onDenied: () => Promise.resolve(),
        load: () => dependencies.resolveScope(interaction, route.action === "retry"),
        onMissing: () => interaction.editReply(terminalPayload(route.locale, "commands.memories.unavailable")),
      });
      if (!initialScope) return;
      let scope = initialScope;
      const ownerFilter = scope.canManage ? undefined : scope.userId;

      if (route.action === "category") {
        // Documents open on the serverwide scope, which is the sentinel 0 rather than a persona.
        const lineageId = route.category === "memories" ? (scope.personas[0]?.persona_lineage_id ?? 0) : 0;
        const memories =
          route.category === "memories" && lineageId
            ? await dependencies.loadMemories(scope.serverId, lineageId, ownerFilter)
            : [];
        await repaint(
          interaction,
          route.locale,
          scope,
          route.category,
          lineageId,
          memories,
          { kind: "main" },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "persona-select") {
        if (!interaction.isStringSelectMenu()) {
          throw new Error("Memories persona-select route requires StringSelectMenu interaction");
        }
        const selectedLineage = Number(interaction.values[0]);
        const validLineage = scope.personas.some((p) => p.persona_lineage_id === selectedLineage)
          ? selectedLineage
          : (scope.personas[0]?.persona_lineage_id ?? 0);
        const memories = validLineage ? await dependencies.loadMemories(scope.serverId, validLineage, ownerFilter) : [];
        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          validLineage,
          memories,
          { kind: "main" },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "persona-page") {
        const validLineage = scope.personas.some((persona) => persona.persona_lineage_id === route.lineageId)
          ? route.lineageId
          : (scope.personas[0]?.persona_lineage_id ?? 0);
        const memories = validLineage ? await dependencies.loadMemories(scope.serverId, validLineage, ownerFilter) : [];
        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          validLineage,
          memories,
          { kind: "main", personaRangeIndex: route.rangeIndex },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "select") {
        const memoryId = Number((interaction as StringSelectMenuInteraction).values[0]);
        const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter);
        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          route.lineageId,
          memories,
          { kind: "main", selectedMemoryId: memoryId, rangeIndex: route.rangeIndex },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "range") {
        const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter);
        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          route.lineageId,
          memories,
          { kind: "main", rangeIndex: route.rangeIndex },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "lore-scope" || route.action === "lore-persona-select") {
        if (route.action === "lore-persona-select" && !interaction.isStringSelectMenu()) {
          throw new Error("Lorebook persona route requires StringSelectMenu interaction");
        }
        const requested =
          route.action === "lore-persona-select"
            ? Number((interaction as StringSelectMenuInteraction).values[0])
            : route.scopeLineageId;
        const scopeLineageId = isValidLorebookScope(scope, requested) ? requested : 0;
        await repaint(
          interaction,
          route.locale,
          scope,
          "lorebooks",
          scopeLineageId,
          [],
          { kind: "lorebooks" },
          scopeLineageId === requested ? undefined : lorebookChangedReceipt(route.locale),
          dependencies,
        );
        return;
      }

      if (route.action === "lore-persona-page") {
        const scopeLineageId = isValidLorebookScope(scope, route.scopeLineageId) ? route.scopeLineageId : 0;
        await repaint(
          interaction,
          route.locale,
          scope,
          "lorebooks",
          scopeLineageId,
          [],
          scopeLineageId === route.scopeLineageId
            ? { kind: "lorebooks", personaRangeIndex: route.rangeIndex }
            : { kind: "lorebooks" },
          scopeLineageId === route.scopeLineageId ? undefined : lorebookChangedReceipt(route.locale),
          dependencies,
        );
        return;
      }

      if (route.action === "lore-select") {
        if (!interaction.isStringSelectMenu()) {
          throw new Error("Lorebook select route requires StringSelectMenu interaction");
        }
        const selectedValue = interaction.values[0] ?? "";
        const entryId = Number(selectedValue);
        const validSelection = Number.isSafeInteger(entryId) && entryId > 0;
        const scopeLineageId = isValidLorebookScope(scope, route.scopeLineageId) ? route.scopeLineageId : 0;
        await repaint(
          interaction,
          route.locale,
          scope,
          "lorebooks",
          scopeLineageId,
          [],
          validSelection && scopeLineageId === route.scopeLineageId
            ? { kind: "lorebooks", selectedEntryId: entryId, rangeIndex: route.rangeIndex }
            : { kind: "lorebooks" },
          validSelection && scopeLineageId === route.scopeLineageId ? undefined : lorebookChangedReceipt(route.locale),
          dependencies,
        );
        return;
      }

      if (route.action === "lore-range") {
        const scopeLineageId = isValidLorebookScope(scope, route.scopeLineageId) ? route.scopeLineageId : 0;
        await repaint(
          interaction,
          route.locale,
          scope,
          "lorebooks",
          scopeLineageId,
          [],
          scopeLineageId === route.scopeLineageId
            ? { kind: "lorebooks", rangeIndex: route.rangeIndex }
            : { kind: "lorebooks" },
          scopeLineageId === route.scopeLineageId ? undefined : lorebookChangedReceipt(route.locale),
          dependencies,
        );
        return;
      }

      if (route.action === "document-scope" || route.action === "document-persona-select") {
        if (route.action === "document-persona-select" && !interaction.isStringSelectMenu()) {
          throw new Error("Document persona route requires StringSelectMenu interaction");
        }
        const submittedPersonaId =
          route.action === "document-persona-select"
            ? Number((interaction as StringSelectMenuInteraction).values[0])
            : route.personaId;
        const personaId =
          submittedPersonaId === 0 || scope.personas.some((persona) => persona.persona_id === submittedPersonaId)
            ? submittedPersonaId
            : 0;
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          personaId,
          [],
          { kind: "documents" },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "document-select") {
        if (!interaction.isStringSelectMenu()) {
          throw new Error("Document select route requires StringSelectMenu interaction");
        }
        const documentId = Number(interaction.values[0]);
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          route.personaId,
          [],
          { kind: "documents", selectedDocumentId: documentId, rangeIndex: route.rangeIndex },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "document-persona-page") {
        const personaId = scope.personas.some((persona) => persona.persona_id === route.personaId)
          ? route.personaId
          : (scope.personas.find((persona) => persona.persona_id)?.persona_id ?? 0);
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          personaId,
          [],
          { kind: "documents", personaRangeIndex: route.rangeIndex },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "document-range") {
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          route.personaId,
          [],
          { kind: "documents", rangeIndex: route.rangeIndex },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "document-chunk-prev" || route.action === "document-chunk-next") {
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          route.personaId,
          [],
          { kind: "documents", selectedDocumentId: route.documentId, chunkIdx: route.chunkIdx },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "document-remove-prompt" || route.action === "history-remove-prompt") {
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          route.personaId,
          [],
          {
            kind: "document-remove",
            documentId: route.documentId,
            historyOnly: route.action === "history-remove-prompt",
          },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "document-remove-cancel" || route.action === "history-remove-cancel") {
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          route.personaId,
          [],
          { kind: "documents", selectedDocumentId: route.documentId },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "document-chunk-remove-prompt") {
        if (!scope.canManage) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "documents",
            route.personaId,
            [],
            { kind: "documents", selectedDocumentId: route.documentId, chunkIdx: route.chunkIdx },
            receipt(route.locale, "manager_only"),
            dependencies,
          );
          return;
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          route.personaId,
          [],
          { kind: "document-chunk-remove", documentId: route.documentId, chunkIdx: route.chunkIdx },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "document-chunk-remove-cancel") {
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          route.personaId,
          [],
          { kind: "documents", selectedDocumentId: route.documentId, chunkIdx: route.chunkIdx },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "vectorize-prompt") {
        const representativeMatches = scope.personas.some(
          (persona) => persona.persona_id === route.personaId && persona.persona_lineage_id === route.lineageId,
        );
        const memories = representativeMatches
          ? await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter)
          : [];
        const target = memories.find((memory) => memory.server_memory_id === route.memoryId);
        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          route.lineageId,
          memories,
          target ? { kind: "vectorize", memoryId: route.memoryId, personaId: route.personaId } : { kind: "main" },
          target ? undefined : changedStateReceipt(route.locale),
          dependencies,
        );
        return;
      }

      if (route.action === "vectorize-cancel") {
        const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter);
        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          route.lineageId,
          memories,
          { kind: "main", selectedMemoryId: route.memoryId },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "document-add-submit") {
        const modal = interaction as ModalSubmitInteraction;
        const documentName = modal.fields.getTextInputValue(buildDocumentModalFieldId("name", route.nonce));
        const channelDiscIds = takeChannelScope(
          dependencies,
          modal,
          buildDocumentModalFieldId("channels", route.nonce),
        );
        const personaId = route.personaId === 0 ? null : route.personaId;
        const personaMatches = personaId === null || scope.personas.some((persona) => persona.persona_id === personaId);
        if (!personaMatches || !channelDiscIds) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "documents",
            route.personaId,
            [],
            { kind: "documents" },
            changedStateReceipt(route.locale),
            dependencies,
          );
          return;
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          route.personaId,
          [],
          { kind: "documents" },
          workingReceipt(route.locale, "document_working"),
          dependencies,
        );
        const action = await performPanelAction(
          () =>
            dependencies.documentOperations.add({
              serverId: scope.serverId,
              personaId,
              userId: scope.userId,
              userDiscId: scope.userDiscId,
              workspaceId: scope.workspaceId,
              configuredEmbeddingModelId: scope.configuredEmbeddingModelId,
              isBlacklisted: scope.isBlacklisted,
              canManage: scope.canManage,
              memteachingEnabled: scope.memteachingEnabled,
              documentName,
              attachment: dependencies.takeDocumentFileUpload(interaction.id, route.nonce),
              channelDiscIds,
            }),
          () => dependencies.resolveScope(interaction, true),
        );
        scope = action.state ?? scope;
        const result = action.result;
        if (result.status === "success") {
          dependencies.recordAction({
            action: "memories.workspace.document.add",
            serverId: scope.serverId,
            userDiscId: scope.userDiscId,
          });
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          route.personaId,
          [],
          {
            kind: "documents",
            selectedDocumentId: result.status === "success" ? result.documentId : undefined,
          },
          result.status === "success"
            ? receipt(route.locale, "document_added", {
                name: result.documentName,
                chunks: result.chunkCount,
              })
            : documentResultReceipt(route.locale, result, {
                maxSize: getMemoryLimits().maxDocumentSizeMB,
                maxText: getMemoryLimits().maxDocumentTextLength,
                maxChunks: getMemoryLimits().maxDocumentChunks,
                maxDocuments: getMemoryLimits().maxDocumentsPerServer,
                maxTotalChunks: getMemoryLimits().maxDocumentChunksPerServer,
              }),
          dependencies,
        );
        return;
      }

      if (route.action === "document-remove-confirm" || route.action === "history-remove-confirm") {
        const personaId = route.personaId === 0 ? null : route.personaId;
        const documentsBeforeRemoval = [...(await dependencies.loadDocuments(scope.serverId, personaId))];
        const action = await performPanelAction(
          () =>
            dependencies.documentOperations.remove({
              serverId: scope.serverId,
              personaId,
              documentId: route.documentId,
              workspaceId: scope.workspaceId,
              isBlacklisted: scope.isBlacklisted,
              canManage: scope.canManage,
              memteachingEnabled: scope.memteachingEnabled,
              historyOnly: route.action === "history-remove-confirm",
            }),
          () => dependencies.resolveScope(interaction, true),
        );
        scope = action.state ?? scope;
        const result = action.result;
        if (result.status === "success") {
          dependencies.recordAction({
            action:
              route.action === "history-remove-confirm"
                ? "memories.workspace.history-document.remove"
                : "memories.workspace.document.remove",
            serverId: scope.serverId,
            userDiscId: scope.userDiscId,
          });
        }
        const rangeIndex =
          result.status === "success"
            ? rangeIndexAfterRemoval(
                documentsBeforeRemoval,
                route.documentId,
                (document) => document.document_id,
                Math.max(0, documentsBeforeRemoval.length - 1),
                MAX_DOCUMENT_PAGE_SIZE,
              )
            : undefined;
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          route.personaId,
          [],
          rangeIndex === undefined ? { kind: "documents" } : { kind: "documents", rangeIndex },
          result.status === "success"
            ? receipt(route.locale, "document_removed", { name: result.documentName })
            : documentResultReceipt(route.locale, result),
          dependencies,
        );
        return;
      }

      if (route.action === "document-chunk-edit-submit") {
        const modal = interaction as ModalSubmitInteraction;
        const content = modal.fields.getTextInputValue(buildDocumentModalFieldId("content", route.nonce));
        const channelDiscIds = takeChannelScope(
          dependencies,
          modal,
          buildDocumentModalFieldId("channels", route.nonce),
        );
        if (!channelDiscIds) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "documents",
            route.personaId,
            [],
            { kind: "documents", selectedDocumentId: route.documentId, chunkIdx: route.chunkIdx },
            changedStateReceipt(route.locale),
            dependencies,
          );
          return;
        }
        const action = await performPanelAction(
          () =>
            dependencies.documentOperations.editChunk({
              serverId: scope.serverId,
              personaId: route.personaId === 0 ? null : route.personaId,
              documentId: route.documentId,
              chunkIdx: route.chunkIdx,
              workspaceId: scope.workspaceId,
              userId: scope.userId,
              configuredEmbeddingModelId: scope.configuredEmbeddingModelId,
              canManage: scope.canManage,
              content,
              channelDiscIds,
            }),
          () => dependencies.resolveScope(interaction, true),
        );
        scope = action.state ?? scope;
        const result = action.result;
        if (result.status === "success") {
          dependencies.recordAction({
            action: "memories.workspace.document-chunk.edit",
            serverId: scope.serverId,
            userDiscId: scope.userDiscId,
          });
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          route.personaId,
          [],
          { kind: "documents", selectedDocumentId: route.documentId, chunkIdx: route.chunkIdx },
          result.status === "success"
            ? receipt(route.locale, "document_chunk_edited")
            : documentResultReceipt(route.locale, result),
          dependencies,
        );
        return;
      }

      if (route.action === "document-chunk-remove-confirm") {
        const personaId = route.personaId === 0 ? null : route.personaId;
        const documentsBeforeRemoval = [...(await dependencies.loadDocuments(scope.serverId, personaId))];
        const action = await performPanelAction(
          () =>
            dependencies.documentOperations.removeChunk({
              serverId: scope.serverId,
              personaId,
              documentId: route.documentId,
              chunkIdx: route.chunkIdx,
              workspaceId: scope.workspaceId,
              canManage: scope.canManage,
            }),
          () => dependencies.resolveScope(interaction, true),
        );
        scope = action.state ?? scope;
        const result = action.result;
        if (result.status === "success") {
          dependencies.recordAction({
            action: "memories.workspace.document-chunk.remove",
            serverId: scope.serverId,
            userDiscId: scope.userDiscId,
          });
        }
        const rangeIndex =
          result.status === "success"
            ? rangeIndexAfterRemoval(
                documentsBeforeRemoval,
                route.documentId,
                (document) => document.document_id,
                result.removedDocument ? Math.max(0, documentsBeforeRemoval.length - 1) : documentsBeforeRemoval.length,
                MAX_DOCUMENT_PAGE_SIZE,
              )
            : undefined;
        await repaint(
          interaction,
          route.locale,
          scope,
          "documents",
          route.personaId,
          [],
          result.status === "success" && !result.removedDocument
            ? rangeIndex === undefined
              ? { kind: "documents", selectedDocumentId: route.documentId }
              : { kind: "documents", selectedDocumentId: route.documentId, rangeIndex }
            : rangeIndex === undefined
              ? { kind: "documents" }
              : { kind: "documents", rangeIndex },
          result.status === "success"
            ? receipt(
                route.locale,
                result.removedDocument ? "document_removed_with_last_chunk" : "document_chunk_removed",
              )
            : documentResultReceipt(route.locale, result),
          dependencies,
        );
        return;
      }

      if (route.action === "vectorize-submit") {
        const modal = interaction as ModalSubmitInteraction;
        const content = modal.fields.getTextInputValue(buildDocumentModalFieldId("content", route.nonce));
        const documentName = modal.fields.getTextInputValue(buildDocumentModalFieldId("name", route.nonce));
        const channelDiscIds = takeChannelScope(
          dependencies,
          modal,
          buildDocumentModalFieldId("channels", route.nonce),
        );
        const personaMatches = scope.personas.some(
          (persona) => persona.persona_id === route.personaId && persona.persona_lineage_id === route.lineageId,
        );
        if (!personaMatches || !channelDiscIds) {
          const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter);
          await repaint(
            interaction,
            route.locale,
            scope,
            "memories",
            route.lineageId,
            memories,
            { kind: "main" },
            changedStateReceipt(route.locale),
            dependencies,
          );
          return;
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          route.lineageId,
          await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter),
          { kind: "main" },
          workingReceipt(route.locale, "vectorize_working"),
          dependencies,
        );
        const action = await performPanelAction(
          () =>
            dependencies.documentOperations.vectorize({
              serverId: scope.serverId,
              personaId: route.personaId,
              personaLineageId: route.lineageId,
              memoryId: route.memoryId,
              userId: scope.userId,
              userDiscId: scope.userDiscId,
              workspaceId: scope.workspaceId,
              configuredEmbeddingModelId: scope.configuredEmbeddingModelId,
              isBlacklisted: scope.isBlacklisted,
              canManage: scope.canManage,
              memteachingEnabled: scope.memteachingEnabled,
              content,
              documentName,
              channelDiscIds,
            }),
          () => dependencies.resolveScope(interaction, true),
        );
        scope = action.state ?? scope;
        const result = action.result;
        const currentOwner = scope.canManage ? undefined : scope.userId;
        const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, currentOwner);
        if (result.status === "success") {
          dependencies.recordAction({
            action: "memories.workspace.memory.vectorize",
            serverId: scope.serverId,
            userDiscId: scope.userDiscId,
          });
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          route.lineageId,
          memories,
          { kind: "main" },
          result.status === "success"
            ? receipt(route.locale, "vectorized", {
                name: result.documentName,
                chunks: result.chunkCount,
              })
            : result.status === "partial-failure"
              ? receipt(route.locale, "vectorize_partial_failure", { name: result.documentName })
              : documentResultReceipt(route.locale, result),
          dependencies,
        );
        return;
      }

      if (route.action === "stm-submit") {
        if (!scope.canManage) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "stm",
            0,
            [],
            { kind: "main" },
            receipt(route.locale, "manager_only"),
            dependencies,
          );
          return;
        }
        await dependencies.preWarmServerStm(scope.workspaceId);
        const entries = await dependencies.getStmEntries(scope.workspaceId, scope.personas, route.locale);
        const fingerprint = computeServerStmFingerprint(scope.workspaceId, scope.userDiscId, entries);
        if (fingerprint !== route.nonce || entries.length > MAX_STM_MANAGEABLE_ENTRIES) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "stm",
            0,
            [],
            { kind: "main" },
            receipt(route.locale, "stm_changed_state"),
            dependencies,
          );
          return;
        }
        const checked = new Set<string>();
        const groupCount = Math.ceil(entries.length / MAX_STM_OPTIONS_PER_GROUP);
        for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
          for (const value of dependencies.takeCheckboxValues(
            interaction.id,
            buildStmCheckboxFieldId(groupIndex, route.nonce),
          ) ?? []) {
            const parsedValue = parseInteractionRoute(value);
            const entryRoute = parsedValue ? parseMemoriesPanelRoute(parsedValue) : null;
            if (entryRoute?.action === "stm-entry") {
              checked.add(`${entryRoute.channelId}:${entryRoute.personaId}`);
            }
          }
        }
        const toClear = entries.filter((entry) => !checked.has(`${entry.channelId}:${entry.personaId ?? 0}`));
        for (const entry of toClear) {
          dependencies.clearStm(scope.workspaceId, entry.channelId, entry.personaId ?? null);
        }
        if (toClear.length > 0) {
          dependencies.recordAction({
            action: "memories.workspace.stm.clear",
            serverId: scope.serverId,
            userDiscId: scope.userDiscId,
          });
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "stm",
          0,
          [],
          { kind: "main" },
          toClear.length > 0
            ? receipt(route.locale, "stm_cleared", { count: toClear.length })
            : noChangesReceipt(route.locale),
          dependencies,
        );
        return;
      }

      if (route.action === "lore-add-submit") {
        const guard = await guardLorebookWrite(interaction, route.locale, scope, route.scopeLineageId, dependencies);
        if (!guard.ok) return;
        const modal = interaction as ModalSubmitInteraction;
        const nonce = route.nonce;
        const channelDiscIds = await takeLorebookChannelScope(dependencies, modal, nonce);
        if (!channelDiscIds) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks" },
            receipt(route.locale, "lorebook_channels_invalid"),
            dependencies,
          );
          return;
        }
        const placement = parseLorebookPlacement(
          dependencies.takeStringSelectValues(interaction.id, buildLorebookModalFieldId("placement", nonce))?.[0],
        );
        if (placement === null) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks" },
            receipt(route.locale, "lorebook_invalid_selection", {
              field: localizer(route.locale, "commands.memories.lorebook_placement_label"),
            }),
            dependencies,
          );
          return;
        }
        const result = await dependencies.lorebookOperations.add({
          serverId: scope.serverId,
          lineageId: guard.lineageId,
          canManage: scope.canManage,
          title: readModalField(modal, buildLorebookModalFieldId("title", nonce)) ?? "",
          content: readModalField(modal, buildLorebookModalFieldId("content", nonce)) ?? "",
          keys: parseLorebookKeys(readModalField(modal, buildLorebookModalFieldId("keys", nonce)) ?? ""),
          placement,
          channelDiscIds,
        });
        if (result.status === "success") {
          dependencies.recordAction({
            action: "memories.workspace.lorebook.add",
            serverId: scope.serverId,
            userDiscId: scope.userDiscId,
          });
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks", selectedEntryId: result.entryId },
            receipt(route.locale, "lorebook_added", { title: result.title }),
            dependencies,
          );
          return;
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "lorebooks",
          route.scopeLineageId,
          [],
          { kind: "lorebooks" },
          lorebookResultReceipt(route.locale, result.status, {
            max: LOREBOOK_ENTRIES_PER_SCOPE_MAX,
          }),
          dependencies,
        );
        return;
      }

      if (route.action === "lore-import-submit") {
        const guard = await guardLorebookWrite(interaction, route.locale, scope, route.scopeLineageId, dependencies);
        if (!guard.ok) return;
        const attachment = dependencies.takeLorebookFileUpload(interaction.id, route.nonce);
        if (!attachment) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks" },
            receipt(route.locale, "lorebook_import_failed"),
            dependencies,
          );
          return;
        }
        const maxBytes = LOREBOOK_IMPORT_MAX_FILE_MB * 1024 * 1024;
        if (attachment.size > maxBytes) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks" },
            receipt(route.locale, "lorebook_import_too_large", { max: LOREBOOK_IMPORT_MAX_FILE_MB }),
            dependencies,
          );
          return;
        }
        const download = await safeDownload(attachment.url, {
          maxSizeMB: LOREBOOK_IMPORT_MAX_FILE_MB,
          timeoutMs: 15_000,
          knownSize: attachment.size,
        });
        if (!download.success || !download.buffer) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks" },
            receipt(route.locale, "lorebook_import_failed"),
            dependencies,
          );
          return;
        }
        const parsed = dependencies.parseLorebookUpload(download.buffer);
        if (!parsed.ok) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks" },
            receipt(
              route.locale,
              parsed.reason === "invalid_json" ? "lorebook_invalid_json" : "lorebook_import_unsupported",
            ),
            dependencies,
          );
          return;
        }
        const { entries, report } = parsed.conversion;
        if (entries.length === 0) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks" },
            receipt(route.locale, "lorebook_import_empty"),
            dependencies,
          );
          return;
        }
        if (entries.length > LOREBOOK_ENTRIES_PER_SCOPE_MAX) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks" },
            receipt(route.locale, "lorebook_import_limit", { max: LOREBOOK_ENTRIES_PER_SCOPE_MAX }),
            dependencies,
          );
          return;
        }
        const replace =
          dependencies
            .takeCheckboxValues(interaction.id, buildLorebookModalFieldId("replace", route.nonce))
            ?.includes("replace") ?? false;
        const writeResult = replace
          ? await lorebookRepository.replaceScopeEntries(scope.serverId, guard.lineageId, entries)
          : await lorebookRepository.appendScopeEntries(scope.serverId, guard.lineageId, entries);
        if (
          report.skippedEntries > 0 ||
          report.unsupportedKeys > 0 ||
          report.ignoredEntries > 0 ||
          report.collapsedPlacement > 0
        ) {
          log.warn("Lorebook import dropped unsupported data", undefined, {
            metadata: {
              skippedEntries: report.skippedEntries,
              unsupportedKeys: report.unsupportedKeys,
              ignoredEntries: report.ignoredEntries,
              collapsedPlacement: report.collapsedPlacement,
            },
          });
        }
        if (writeResult === "replaced" || (typeof writeResult !== "string" && writeResult.status === "appended")) {
          dependencies.recordAction({
            action: "memories.workspace.lorebook.import",
            serverId: scope.serverId,
            userDiscId: scope.userDiscId,
          });
          const importReceipt =
            writeResult === "replaced"
              ? receipt(route.locale, "lorebook_import_replaced", { count: entries.length })
              : receipt(route.locale, "lorebook_imported", {
                  added: writeResult.added,
                  skipped: writeResult.skipped + report.skippedEntries,
                });
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks" },
            importReceipt,
            dependencies,
          );
          return;
        }
        const status = typeof writeResult === "string" ? writeResult : writeResult.status;
        await repaint(
          interaction,
          route.locale,
          scope,
          "lorebooks",
          route.scopeLineageId,
          [],
          { kind: "lorebooks" },
          status === "limit"
            ? receipt(route.locale, "lorebook_import_limit", { max: LOREBOOK_ENTRIES_PER_SCOPE_MAX })
            : status === "invalid"
              ? receipt(route.locale, "lorebook_import_invalid")
              : receipt(route.locale, "lorebook_import_failed"),
          dependencies,
        );
        return;
      }

      if (route.action === "lore-edit-submit") {
        const guard = await guardLorebookWrite(interaction, route.locale, scope, route.scopeLineageId, dependencies);
        if (!guard.ok) return;
        const modal = interaction as ModalSubmitInteraction;
        const channelDiscIds = await takeLorebookChannelScope(dependencies, modal, route.nonce);
        if (!channelDiscIds) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks", selectedEntryId: route.entryId },
            receipt(route.locale, "lorebook_channels_invalid"),
            dependencies,
          );
          return;
        }
        const placement = parseLorebookPlacement(
          dependencies.takeStringSelectValues(interaction.id, buildLorebookModalFieldId("placement", route.nonce))?.[0],
        );
        if (placement === null) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks", selectedEntryId: route.entryId },
            receipt(route.locale, "lorebook_invalid_selection", {
              field: localizer(route.locale, "commands.memories.lorebook_placement_label"),
            }),
            dependencies,
          );
          return;
        }
        const result = await dependencies.lorebookOperations.editEntry({
          serverId: scope.serverId,
          lineageId: guard.lineageId,
          canManage: scope.canManage,
          entryId: route.entryId,
          title: readModalField(modal, buildLorebookModalFieldId("title", route.nonce)) ?? "",
          content: readModalField(modal, buildLorebookModalFieldId("content", route.nonce)) ?? "",
          keys: parseLorebookKeys(readModalField(modal, buildLorebookModalFieldId("keys", route.nonce)) ?? ""),
          placement,
          channelDiscIds,
        });
        if (result.status === "success") {
          dependencies.recordAction({
            action: "memories.workspace.lorebook.edit",
            serverId: scope.serverId,
            userDiscId: scope.userDiscId,
          });
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks", selectedEntryId: route.entryId },
            receipt(route.locale, "lorebook_edited", { title: result.title }),
            dependencies,
          );
          return;
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "lorebooks",
          route.scopeLineageId,
          [],
          { kind: "lorebooks", selectedEntryId: route.entryId },
          lorebookResultReceipt(route.locale, result.status),
          dependencies,
        );
        return;
      }

      if (route.action === "lore-activation-submit") {
        const guard = await guardLorebookWrite(interaction, route.locale, scope, route.scopeLineageId, dependencies);
        if (!guard.ok) return;
        const modal = interaction as ModalSubmitInteraction;
        const secondaryLogic = parseLorebookSelectiveLogic(
          dependencies.takeStringSelectValues(
            interaction.id,
            buildLorebookModalFieldId("secondary_logic", route.nonce),
          )?.[0],
        );
        if (secondaryLogic === null) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks", selectedEntryId: route.entryId },
            receipt(route.locale, "lorebook_invalid_selection", {
              field: localizer(route.locale, "commands.memories.lorebook_secondary_logic_label"),
            }),
            dependencies,
          );
          return;
        }
        const readNumber = (
          field: "scan_depth" | "trigger_chance" | "insertion_order",
          min: number,
          max: number,
        ): number | null => {
          const raw = readModalField(modal, buildLorebookModalFieldId(field, route.nonce));
          if (raw === null) return null;
          return parseLorebookInteger(raw, min, max);
        };
        const scanDepth = readNumber("scan_depth", 1, 100);
        const triggerChance = readNumber("trigger_chance", 1, 100);
        const insertionOrder = readNumber("insertion_order", -2147483648, 2147483647);
        const invalidField =
          scanDepth === null
            ? {
                key: "commands.memories.lorebook_scan_depth_label",
                min: 1,
                max: 100,
              }
            : triggerChance === null
              ? {
                  key: "commands.memories.lorebook_trigger_chance_label",
                  min: 1,
                  max: 100,
                }
              : insertionOrder === null
                ? {
                    key: "commands.memories.lorebook_insertion_order_label",
                    min: -2147483648,
                    max: 2147483647,
                  }
                : null;
        if (invalidField || scanDepth === null || triggerChance === null || insertionOrder === null) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks", selectedEntryId: route.entryId },
            receipt(route.locale, "lorebook_invalid_number", {
              field: localizer(route.locale, invalidField?.key ?? "commands.memories.lorebook_scan_depth_label"),
              min: invalidField?.min ?? 1,
              max: invalidField?.max ?? 100,
            }),
            dependencies,
          );
          return;
        }
        const result = await dependencies.lorebookOperations.editActivation({
          serverId: scope.serverId,
          lineageId: guard.lineageId,
          canManage: scope.canManage,
          entryId: route.entryId,
          secondaryKeys: parseLorebookKeys(
            readModalField(modal, buildLorebookModalFieldId("secondary_keys", route.nonce)) ?? "",
          ),
          selectiveLogic: secondaryLogic,
          scanDepth,
          triggerChance,
          insertionOrder,
        });
        if (result.status === "success") {
          dependencies.recordAction({
            action: "memories.workspace.lorebook.activation",
            serverId: scope.serverId,
            userDiscId: scope.userDiscId,
          });
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks", selectedEntryId: route.entryId },
            receipt(route.locale, "lorebook_activation_saved", { title: result.title }),
            dependencies,
          );
          return;
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "lorebooks",
          route.scopeLineageId,
          [],
          { kind: "lorebooks", selectedEntryId: route.entryId },
          lorebookResultReceipt(route.locale, result.status),
          dependencies,
        );
        return;
      }

      if (route.action === "lore-toggle-enabled" || route.action === "lore-toggle-constant") {
        const guard = await guardLorebookWrite(interaction, route.locale, scope, route.scopeLineageId, dependencies);
        if (!guard.ok) return;
        const lorebooks = await dependencies.loadLorebooks(scope.serverId, guard.lineageId);
        const target =
          lorebooks.status === "fresh"
            ? lorebooks.entries.find((entry) => entry.entry_id === route.entryId)
            : undefined;
        if (!target) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks" },
            lorebooks.status === "fresh"
              ? lorebookChangedReceipt(route.locale)
              : receipt(route.locale, "lorebook_read_failed"),
            dependencies,
          );
          return;
        }
        if (route.action === "lore-toggle-constant" && target.constant && target.keys.length === 0) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks", selectedEntryId: target.entry_id },
            receipt(route.locale, "lorebook_keys_required"),
            dependencies,
          );
          return;
        }
        const flags =
          route.action === "lore-toggle-enabled" ? { enabled: !target.enabled } : { constant: !target.constant };
        const result = await dependencies.lorebookOperations.setFlags({
          serverId: scope.serverId,
          lineageId: guard.lineageId,
          canManage: scope.canManage,
          entryId: route.entryId,
          flags,
        });
        if (result.status === "success") {
          dependencies.recordAction({
            action: "memories.workspace.lorebook.set",
            serverId: scope.serverId,
            userDiscId: scope.userDiscId,
          });
          const receiptKey =
            route.action === "lore-toggle-enabled"
              ? target.enabled
                ? "lorebook_disabled"
                : "lorebook_enabled"
              : target.constant
                ? "lorebook_keywords"
                : "lorebook_always_on";
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks", selectedEntryId: target.entry_id },
            receipt(route.locale, receiptKey, { title: target.title }),
            dependencies,
          );
          return;
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "lorebooks",
          route.scopeLineageId,
          [],
          { kind: "lorebooks", selectedEntryId: target.entry_id },
          lorebookResultReceipt(route.locale, result.status),
          dependencies,
        );
        return;
      }

      if (route.action === "lore-remove-prompt") {
        const guard = await guardLorebookWrite(interaction, route.locale, scope, route.scopeLineageId, dependencies);
        if (!guard.ok) return;
        const lorebooks = await dependencies.loadLorebooks(scope.serverId, guard.lineageId);
        const target =
          lorebooks.status === "fresh"
            ? lorebooks.entries.find((entry) => entry.entry_id === route.entryId)
            : undefined;
        if (!target) {
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks" },
            lorebooks.status === "fresh"
              ? lorebookChangedReceipt(route.locale)
              : receipt(route.locale, "lorebook_read_failed"),
            dependencies,
          );
          return;
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "lorebooks",
          route.scopeLineageId,
          [],
          { kind: "lore-remove", entryId: target.entry_id },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "lore-remove-cancel") {
        await repaint(
          interaction,
          route.locale,
          scope,
          "lorebooks",
          isValidLorebookScope(scope, route.scopeLineageId) ? route.scopeLineageId : 0,
          [],
          { kind: "lorebooks", selectedEntryId: route.entryId },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "lore-remove-confirm") {
        const guard = await guardLorebookWrite(interaction, route.locale, scope, route.scopeLineageId, dependencies);
        if (!guard.ok) return;
        const before = await dependencies.loadLorebooks(scope.serverId, guard.lineageId);
        const entriesBeforeRemoval = before.status === "fresh" ? before.entries : [];
        const result = await dependencies.lorebookOperations.remove({
          serverId: scope.serverId,
          lineageId: guard.lineageId,
          canManage: scope.canManage,
          entryId: route.entryId,
        });
        if (result.status === "success") {
          dependencies.recordAction({
            action: "memories.workspace.lorebook.remove",
            serverId: scope.serverId,
            userDiscId: scope.userDiscId,
          });
          const rangeIndex =
            rangeIndexAfterRemoval(
              entriesBeforeRemoval,
              route.entryId,
              (entry) => entry.entry_id,
              Math.max(0, entriesBeforeRemoval.length - 1),
              LOREBOOK_ENTRY_PAGE_SIZE,
            ) ?? 0;
          await repaint(
            interaction,
            route.locale,
            scope,
            "lorebooks",
            route.scopeLineageId,
            [],
            { kind: "lorebooks", rangeIndex },
            receipt(route.locale, "lorebook_removed", { title: result.title }),
            dependencies,
          );
          return;
        }
        await repaint(
          interaction,
          route.locale,
          scope,
          "lorebooks",
          route.scopeLineageId,
          [],
          { kind: "lorebooks" },
          lorebookResultReceipt(route.locale, result.status),
          dependencies,
        );
        return;
      }

      if (route.action === "add-submit") {
        const modal = interaction as ModalSubmitInteraction;
        let content = "";
        try {
          content = modal.fields.getTextInputValue(buildServerMemoryModalFieldId("content", route.nonce));
        } catch {
          // Optional when file is uploaded
        }
        const uploadedFile = dependencies.takeFileUpload(interaction.id, route.nonce);
        const channelDiscIds = takeChannelScope(
          dependencies,
          modal,
          buildServerMemoryModalFieldId("channels", route.nonce),
        );

        const representative = personaRepresentativeForLineage(scope.personas, route.lineageId);
        const personaId = representative?.persona_id;

        if (!channelDiscIds) {
          const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter);
          await repaint(
            interaction,
            route.locale,
            scope,
            "memories",
            route.lineageId,
            memories,
            { kind: "main" },
            changedStateReceipt(route.locale),
            dependencies,
          );
          return;
        }

        if (!personaId) {
          const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter);
          await repaint(
            interaction,
            route.locale,
            scope,
            "memories",
            route.lineageId,
            memories,
            { kind: "main" },
            receipt(route.locale, "write_failed"),
            dependencies,
          );
          return;
        }

        if (uploadedFile) {
          const upload = await dependencies.readUploadedText(uploadedFile);
          if (!upload.isValid || !upload.text) {
            const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter);
            await repaint(
              interaction,
              route.locale,
              scope,
              "memories",
              route.lineageId,
              memories,
              { kind: "main" },
              receipt(route.locale, upload.error === "file_too_large" ? "batch_file_too_large" : "batch_file_invalid"),
              dependencies,
            );
            return;
          }

          const uploaded = getNonEmptyNumberedLines(upload.text).map((line) => line.content);
          const typed = content.trim();
          const batchAction = await performPanelAction(
            () =>
              dependencies.operations.addBatch({
                serverId: scope.serverId,
                personaId,
                personaLineageId: route.lineageId,
                taughtByUserId: scope.userId,
                workspaceId: scope.workspaceId,
                isBlacklisted: scope.isBlacklisted,
                canManage: scope.canManage,
                memteachingEnabled: scope.memteachingEnabled,
                contents: typed ? [typed, ...uploaded] : uploaded,
                channelDiscIds,
              }),
            () => dependencies.resolveScope(interaction, true),
          );
          const batchResult = batchAction.result;
          scope = batchAction.state ?? scope;
          const currentOwnerFilter = scope.canManage ? undefined : scope.userId;
          const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, currentOwnerFilter);

          if (batchResult.status === "success") {
            dependencies.recordAction({
              action: "memories.workspace.memory.add",
              serverId: scope.serverId,
              userDiscId: interaction.user.id,
            });
            await repaint(
              interaction,
              route.locale,
              scope,
              "memories",
              route.lineageId,
              memories,
              { kind: "main" },
              receipt(route.locale, "batch_added", {
                added: batchResult.added,
                skipped: batchResult.skipped,
              }),
              dependencies,
            );
            return;
          }

          const batchReceiptByStatus: Record<string, MemoryReceiptKey> = {
            blacklisted: "blacklisted_error",
            "teaching-disabled": "teaching_disabled_error",
            "empty-content": "empty_content",
            "content-too-long": "content_too_long",
            "all-duplicates": "batch_all_duplicates",
            "batch-limit-reached": "batch_limit_reached",
            "write-failed": "write_failed",
          };
          await repaint(
            interaction,
            route.locale,
            scope,
            "memories",
            route.lineageId,
            memories,
            { kind: "main" },
            receipt(route.locale, batchReceiptByStatus[batchResult.status] ?? "write_failed", {
              max: getMemoryLimits().maxServerMemories,
              available: batchResult.status === "batch-limit-reached" ? batchResult.available : 0,
              requested: batchResult.status === "batch-limit-reached" ? batchResult.requested : 0,
            }),
            dependencies,
          );
          return;
        }

        const action = await performPanelAction(
          () =>
            dependencies.operations.add({
              serverId: scope.serverId,
              personaId,
              personaLineageId: route.lineageId,
              taughtByUserId: scope.userId,
              workspaceId: scope.workspaceId,
              isBlacklisted: scope.isBlacklisted,
              canManage: scope.canManage,
              memteachingEnabled: scope.memteachingEnabled,
              content,
              channelDiscIds,
            }),
          () => dependencies.resolveScope(interaction, true),
        );
        const result = action.result;
        scope = action.state ?? scope;
        const currentOwnerFilter = scope.canManage ? undefined : scope.userId;
        const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, currentOwnerFilter);

        if (result.status === "success") {
          dependencies.recordAction({
            action: "memories.workspace.memory.add",
            serverId: scope.serverId,
            userDiscId: interaction.user.id,
          });
          await repaint(
            interaction,
            route.locale,
            scope,
            "memories",
            route.lineageId,
            memories,
            { kind: "main", selectedMemoryId: result.row.server_memory_id },
            receipt(route.locale, "added", { memory: result.row.content }),
            dependencies,
          );
          return;
        }

        const receiptByStatus: Record<string, MemoryReceiptKey> = {
          blacklisted: "blacklisted_error",
          "teaching-disabled": "teaching_disabled_error",
          "empty-content": "empty_content",
          "content-too-long": "content_too_long",
          "limit-reached": "limit_reached",
          "write-failed": "write_failed",
        };
        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          route.lineageId,
          memories,
          { kind: "main" },
          receipt(route.locale, receiptByStatus[result.status] ?? "write_failed", {
            max: getMemoryLimits().maxServerMemories,
          }),
          dependencies,
        );
        return;
      }

      if (route.action === "edit-submit") {
        const modal = interaction as ModalSubmitInteraction;
        const content = modal.fields.getTextInputValue(buildServerMemoryModalFieldId("content", route.nonce));
        const channelDiscIds = takeChannelScope(
          dependencies,
          modal,
          buildServerMemoryModalFieldId("channels", route.nonce),
        );
        if (!channelDiscIds) {
          const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter);
          await repaint(
            interaction,
            route.locale,
            scope,
            "memories",
            route.lineageId,
            memories,
            { kind: "main", selectedMemoryId: route.memoryId },
            changedStateReceipt(route.locale),
            dependencies,
          );
          return;
        }

        const action = await performPanelAction(
          () =>
            dependencies.operations.edit({
              serverId: scope.serverId,
              personaLineageId: route.lineageId,
              taughtByUserId: scope.userId,
              memoryId: route.memoryId,
              workspaceId: scope.workspaceId,
              isBlacklisted: scope.isBlacklisted,
              canManage: scope.canManage,
              memteachingEnabled: scope.memteachingEnabled,
              content,
              channelDiscIds,
            }),
          () => dependencies.resolveScope(interaction, true),
        );
        const result = action.result;
        scope = action.state ?? scope;
        const currentOwnerFilter = scope.canManage ? undefined : scope.userId;
        const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, currentOwnerFilter);

        if (result.status === "success") {
          dependencies.recordAction({
            action: "memories.workspace.memory.edit",
            serverId: scope.serverId,
            userDiscId: interaction.user.id,
          });
          await repaint(
            interaction,
            route.locale,
            scope,
            "memories",
            route.lineageId,
            memories,
            { kind: "main", selectedMemoryId: result.row.server_memory_id },
            receipt(route.locale, "edited", { memory: result.row.content }),
            dependencies,
          );
          return;
        }

        if (result.status === "unchanged") {
          await repaint(
            interaction,
            route.locale,
            scope,
            "memories",
            route.lineageId,
            memories,
            { kind: "main", selectedMemoryId: route.memoryId },
            noChangesReceipt(route.locale),
            dependencies,
          );
          return;
        }

        if (result.status === "not-found") {
          await repaint(
            interaction,
            route.locale,
            scope,
            "memories",
            route.lineageId,
            memories,
            { kind: "main" },
            changedStateReceipt(route.locale),
            dependencies,
          );
          return;
        }

        const receiptByStatus: Record<string, MemoryReceiptKey> = {
          blacklisted: "blacklisted_error",
          "teaching-disabled": "teaching_disabled_error",
          "empty-content": "empty_content",
          "content-too-long": "content_too_long",
          "write-failed": "write_failed",
        };
        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          route.lineageId,
          memories,
          { kind: "main", selectedMemoryId: route.memoryId },
          receipt(route.locale, receiptByStatus[result.status] ?? "write_failed", {
            max: getMemoryLimits().maxServerMemories,
          }),
          dependencies,
        );
        return;
      }

      if (route.action === "remove-prompt") {
        const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter);
        const target = memories.find((m) => m.server_memory_id === route.memoryId);
        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          route.lineageId,
          memories,
          target ? { kind: "remove", memoryId: route.memoryId } : { kind: "main" },
          target ? undefined : changedStateReceipt(route.locale),
          dependencies,
        );
        return;
      }

      if (route.action === "remove-cancel") {
        const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter);
        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          route.lineageId,
          memories,
          { kind: "main", selectedMemoryId: route.memoryId },
          undefined,
          dependencies,
        );
        return;
      }

      if (route.action === "remove-confirm") {
        const memoriesBeforeRemoval = [
          ...(await dependencies.loadMemories(scope.serverId, route.lineageId, ownerFilter)),
        ];
        const action = await performPanelAction(
          () =>
            dependencies.operations.remove({
              serverId: scope.serverId,
              personaLineageId: route.lineageId,
              taughtByUserId: scope.userId,
              memoryId: route.memoryId,
              workspaceId: scope.workspaceId,
              isBlacklisted: scope.isBlacklisted,
              canManage: scope.canManage,
              memteachingEnabled: scope.memteachingEnabled,
            }),
          () => dependencies.resolveScope(interaction, true),
        );
        const result = action.result;
        scope = action.state ?? scope;
        const currentOwnerFilter = scope.canManage ? undefined : scope.userId;
        const memories = await dependencies.loadMemories(scope.serverId, route.lineageId, currentOwnerFilter);

        if (result.status === "success") {
          dependencies.recordAction({
            action: "memories.workspace.memory.remove",
            serverId: scope.serverId,
            userDiscId: interaction.user.id,
          });
          const rangeIndex =
            rangeIndexAfterRemoval(
              memoriesBeforeRemoval,
              route.memoryId,
              (memory) => memory.server_memory_id ?? 0,
              memories.length,
              MAX_SERVER_MEMORY_PAGE_SIZE,
            ) ?? 0;
          await repaint(
            interaction,
            route.locale,
            scope,
            "memories",
            route.lineageId,
            memories,
            { kind: "main", rangeIndex },
            receipt(route.locale, "removed", { memory: result.row.content }),
            dependencies,
          );
          return;
        }

        await repaint(
          interaction,
          route.locale,
          scope,
          "memories",
          route.lineageId,
          memories,
          { kind: "main" },
          result.status === "not-found"
            ? changedStateReceipt(route.locale)
            : receipt(
                route.locale,
                result.status === "blacklisted"
                  ? "blacklisted_error"
                  : result.status === "teaching-disabled"
                    ? "teaching_disabled_error"
                    : "write_failed",
              ),
          dependencies,
        );
        return;
      }

      if (route.action === "retry") {
        const retryLineageId =
          route.category === "lorebooks" &&
          route.lineageId !== undefined &&
          isValidLorebookScope(scope, route.lineageId)
            ? route.lineageId
            : undefined;
        const lineageId =
          route.category === "documents" || route.category === "lorebooks"
            ? (retryLineageId ?? 0)
            : (route.lineageId ?? scope.personas[0]?.persona_lineage_id ?? 0);
        const memories =
          route.category === "memories" && lineageId
            ? await dependencies.loadMemories(scope.serverId, lineageId, ownerFilter)
            : [];
        const page =
          route.category === "documents"
            ? { kind: "documents" as const }
            : route.category === "lorebooks"
              ? { kind: "lorebooks" as const }
              : { kind: "main" as const };
        await repaint(
          interaction,
          route.locale,
          scope,
          route.category,
          lineageId,
          memories,
          page,
          undefined,
          dependencies,
        );
        return;
      }
    },
  };
}

export const memoriesInteractionRoute = createMemoriesInteractionRoute();
