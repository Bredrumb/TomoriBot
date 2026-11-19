import { withProviderUsageContext } from "@/utils/provider/providerUsage";
import {
  createProviderUsageRecorder,
  type ProviderUsageContext,
  findProviderRequestDeniedError,
  type ProviderRequestDeniedError,
  getProviderRequestFailureCopy,
} from "@/utils/provider/providerUsage";
import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";

import type {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ModalSubmitInteraction,
  Client,
  Message,
  SlashCommandSubcommandBuilder,
  TextBasedChannel,
} from "discord.js";
import { ChannelType, MessageFlags, EmbedBuilder, TextInputStyle } from "discord.js";
import { channelScopeAdmits, channelScopeCandidates } from "@/utils/discord/channelScope";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { getSupportedLocales, localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { DISCORD_SELECT_VALUES_MAX } from "@/utils/discord/ui/componentsV2Limits";
import type { ModalChannelSelectField, ModalOptions } from "@/types/discord/modal";
import { respondWithPersonaChoices } from "@/utils/discord/autocomplete/personaAutocomplete";
import { resolveSelectedPersona } from "@/utils/persona/personaOptionValue";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { llmModelRepo, personaRepository, serverMemoryRepository } from "@/utils/db/repositories";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { memoryGuard, reserveDocumentQuota } from "@/utils/security/rateLimiter";
import { generateEmbeddingsBatched, providerSupportsEmbeddingTaskType } from "@/utils/embeddings/embeddingProvider";
import { fetchHistoryAfter } from "@/utils/discord/historyFetcher";
import { formatMessagesForExtraction } from "@/utils/discord/historyFormatter";
import { createDocumentRecord, appendDocumentChunks, finalizeDocumentContent } from "@/utils/documents/documentService";
import {
  buildExtractionUserPrompt,
  composeInCharacterSystemPrompt,
  EXTRACTION_CONVERSATION_SYSTEM_PROMPT,
  EXTRACTION_IN_CHARACTER_SYSTEM_PROMPT,
  EXTRACTION_ROLEPLAY_SYSTEM_PROMPT,
  substituteInCharacterFraming,
  type ExtractionPromptMode,
} from "@/utils/documents/historyExtractionPrompt";
import { ragRepository } from "@/utils/db/repositories";
import type { RetrievedDocumentChunk } from "@/utils/documents/documentService";
import type { EmbeddingModelRow, ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import {
  extractHistoryWindowForProvider,
  type HistoryExtractionOutcome,
} from "@/providers/utils/providerFeatureExecutors";
import { truncateForEmbedDescription } from "@/utils/discord/embedHelper";
import { providerSupportsFeature } from "@/utils/provider/providerInfoRegistry";
import { getEffectiveLlmModelName } from "@/utils/provider/modelDisplay";
import { resolveTextCredentialState } from "@/utils/provider/textModelSelection";
import {
  CredentialUnavailableError,
  getResolvedCapabilityModelId,
  PersonalProviderRequiredError,
  type ResolvedCredentials,
  resolveCapabilityCredentials,
} from "@/utils/provider/credentialResolver";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";
import type { TokenUsage } from "@/utils/text/tokenEstimate";

const MAX_DOCUMENT_NAME_LENGTH = 64;

const HISTORY_EXTRACTION_WINDOW_SIZE = 40;

const DEDUP_CONTEXT_COUNT = 3;

const HISTORY_INCHARACTER_RAG_MAX_RESULTS = 16;

// Deliberately loose 0.3 similarity floor because in-character extraction only needs to seed background awareness.
const HISTORY_INCHARACTER_RAG_MIN_SIMILARITY = 0.3;

type HistoryScope = "persona" | "automatic" | "global";

interface WriteTarget {
  documentId: number;
  documentName: string;
  dbServerId: number;
  personaId: number | null;
}

type HistoryImportStatusTarget = ChatInputCommandInteraction | ModalSubmitInteraction;

interface HistoryImportStatusOptions {
  titleKey?: string;
  descriptionKey?: string;
  description?: string;
  descriptionVars?: Record<string, string | number | boolean>;
  color: ColorCode;
}

async function replaceHistoryImportStatus(
  target: HistoryImportStatusTarget,
  locale: string,
  options: HistoryImportStatusOptions,
): Promise<void> {
  const embed = new EmbedBuilder().setColor(options.color);
  if (options.titleKey) embed.setTitle(localizedStatusTitle(locale, options.titleKey, options.color));
  const description =
    options.description ??
    (options.descriptionKey ? localizer(locale, options.descriptionKey, options.descriptionVars) : undefined);
  if (description) embed.setDescription(description);
  await target.editReply({ embeds: [embed] });
}

function buildFooter(params: {
  firstMessage: Message;
  lastMessage: Message;
  reachedEnd: boolean;
  guildId: string | null;
  channelId: string;
  locale: string;
}): string {
  const { firstMessage, lastMessage, reachedEnd, guildId, channelId, locale } = params;
  const jumpLink = `https://discord.com/channels/${guildId ?? "@me"}/${channelId}/${lastMessage.id}`;
  const endStatusKey = reachedEnd
    ? "commands.learn.history.end_status_reached_end"
    : "commands.learn.history.end_status_more_available";
  return localizer(locale, "commands.learn.history.success_footer", {
    first_unix: Math.floor(firstMessage.createdTimestamp / 1000).toString(),
    last_unix: Math.floor(lastMessage.createdTimestamp / 1000).toString(),
    last_message_id: lastMessage.id,
    jump_link: jumpLink,
    end_status: localizer(locale, endStatusKey),
  });
}

async function loadInCharacterMemoryLines(
  serverId: number,
  personaLineageId: number | null,
  filterChannelIds: readonly string[],
): Promise<string[]> {
  if (personaLineageId == null) return [];

  const rows = await serverMemoryRepository.loadServerMemoryContentTags(serverId, personaLineageId);

  return rows
    .filter((row) => channelScopeAdmits(row.channel_disc_ids, filterChannelIds))
    .map((row) => row.content.trim())
    .filter((content) => content.length > 0);
}

async function retrieveInCharacterChunks(params: {
  serverId: number;
  personaId: number | null;
  query: string;
  embeddingModel: EmbeddingModelRow;
  embeddingApiKey: string;
  filterChannelIds: readonly string[];
  maxResults: number;
}): Promise<RetrievedDocumentChunk[]> {
  const { serverId, personaId, query, embeddingModel, embeddingApiKey, filterChannelIds, maxResults } = params;

  if (!query.trim()) return [];

  return ragRepository.retrieveRelevantChunks({
    serverId,
    personaId,
    query,
    embeddingModel,
    apiKey: embeddingApiKey,
    maxResults,
    minSimilarity: HISTORY_INCHARACTER_RAG_MIN_SIMILARITY,
    channelIds: filterChannelIds,
  });
}

async function showNoFactsExtractedEmbed(
  statusTarget: HistoryImportStatusTarget,
  locale: string,
  footer: string,
): Promise<void> {
  await replaceHistoryImportStatus(statusTarget, locale, {
    titleKey: "commands.learn.history.no_facts_extracted_title",
    description: `${localizer(locale, "commands.learn.history.no_facts_extracted_description")}\n\n${footer}`,
    color: ColorCode.WARN,
  });
}

// Kept separate from showNoFactsExtractedEmbed so a model that cannot emit structured output surfaces the real error
// instead of an empty-result notice.
async function showExtractionFailedEmbed(
  statusTarget: HistoryImportStatusTarget,
  locale: string,
  footer: string,
  failure: { error: string; failedWindows: number; totalWindows: number },
): Promise<void> {
  const headline = localizer(locale, "commands.learn.history.extraction_failed_description", {
    failed_windows: failure.failedWindows.toString(),
    total_windows: failure.totalWindows.toString(),
  });
  const suffix = `\n\n${footer}`;
  const fenceOverhead = "\n\n```\n\n```".length;
  const detail = truncateForEmbedDescription(failure.error, headline.length + suffix.length + fenceOverhead);
  await replaceHistoryImportStatus(statusTarget, locale, {
    titleKey: "commands.learn.history.extraction_failed_title",
    description: `${headline}\n\n\`\`\`\n${detail}\n\`\`\`${suffix}`,
    color: ColorCode.ERROR,
  });
}

async function showExtractionFailureTerminal(
  statusTarget: HistoryImportStatusTarget,
  locale: string,
  footer: string,
  failure: Extract<IncrementalExtractionResult, { ok: false }>,
): Promise<void> {
  if (failure.reason === "extraction-failed") {
    await showExtractionFailedEmbed(statusTarget, locale, footer, failure);
    return;
  }
  if (failure.reason === "provider-denied") {
    const copy = getProviderRequestFailureCopy(failure.denied, locale);
    await replaceHistoryImportStatus(statusTarget, locale, {
      titleKey: copy.titleKey,
      description: `${copy.description}\n\n${footer}`,
      color: ColorCode.ERROR,
    });
    return;
  }
  await showNoFactsExtractedEmbed(statusTarget, locale, footer);
}

const LEARNER_SCOPE_LABEL_KEYS = {
  automatic: "commands.learn.history.learner_choice_automatic",
  global: "commands.learn.history.learner_choice_global",
} as const satisfies Record<Exclude<HistoryScope, "persona">, string>;

function learnerLabelName(label: string): string {
  return label.split(/[(（]/)[0]?.trim() ?? label;
}

// Raw values and localized label prefixes match case-insensitively because Discord submits typed text verbatim when
// no autocomplete choice is picked.
export function resolveLearnerScope(learnerInput: string | null): HistoryScope {
  if (learnerInput === null) return "persona";
  const typed = learnerInput.toLowerCase();
  for (const scope of ["automatic", "global"] as const) {
    const labelNames = getSupportedLocales().map((locale) =>
      learnerLabelName(localizer(locale, LEARNER_SCOPE_LABEL_KEYS[scope])).toLowerCase(),
    );
    if (typed === scope || labelNames.includes(typed)) return scope;
  }
  return "persona";
}

export async function autocomplete(_client: Client, interaction: AutocompleteInteraction): Promise<void> {
  await respondWithPersonaChoices(interaction, interaction.guild?.id ?? interaction.user.id, undefined, [
    { name: localizer(interaction.locale, LEARNER_SCOPE_LABEL_KEYS.automatic), value: "automatic" },
    { name: localizer(interaction.locale, LEARNER_SCOPE_LABEL_KEYS.global), value: "global" },
  ]);
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("history")
    .setDescription(localizer("en-US", "commands.learn.history.description"))
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription(localizer("en-US", "commands.learn.history.name_description"))
        .setRequired(true)
        .setMaxLength(MAX_DOCUMENT_NAME_LENGTH),
    )
    .addStringOption((option) =>
      option
        .setName("start_message_id")
        .setDescription(localizer("en-US", "commands.learn.history.start_message_id_description"))
        .setRequired(true)
        .setMinLength(15)
        .setMaxLength(25),
    )
    .addStringOption((option) =>
      option
        .setName("learner")
        .setDescription(localizer("en-US", "commands.learn.history.learner_description"))
        .setRequired(false)
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName("end_message_id")
        .setDescription(localizer("en-US", "commands.learn.history.end_message_id_description"))
        .setRequired(false)
        .setMinLength(15)
        .setMaxLength(25),
    )
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription(localizer("en-US", "commands.learn.history.prompt_description"))
        .setRequired(false)
        .addChoices(
          {
            name: localizer("en-US", "commands.learn.history.prompt_choice_conversation"),
            value: "conversation",
          },
          {
            name: localizer("en-US", "commands.learn.history.prompt_choice_roleplay"),
            value: "roleplay",
          },
          {
            name: localizer("en-US", "commands.learn.history.prompt_choice_in_character"),
            value: "in_character",
          },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(localizer("en-US", "commands.learn.history.limit_description"))
        .setRequired(false)
        .setMinValue(50)
        .setMaxValue(100),
    );

const EXTRACTION_PROMPT_MODAL_ID = "memory_history_import_prompt_modal";
const EXTRACTION_CHANNELS_FIELD_ID = "channels";
const EXTRACTION_PROMPT_FIELD_ID = "system_prompt";
const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export function buildExtractionPromptModal(defaultPrompt: string, inServer: boolean): ModalOptions {
  const channelField: ModalChannelSelectField = {
    kind: "channelSelect",
    customId: EXTRACTION_CHANNELS_FIELD_ID,
    labelKey: "commands.learn.history.prompt_modal_channels_label",
    descriptionKey: "commands.learn.history.prompt_modal_channels_description",
    channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
    minValues: 0,
    maxValues: DISCORD_SELECT_VALUES_MAX,
    required: false,
  };
  return {
    modalCustomId: EXTRACTION_PROMPT_MODAL_ID,
    modalTitleKey: "commands.learn.history.prompt_modal_title",
    components: [
      ...(inServer ? [channelField] : []),
      {
        customId: EXTRACTION_PROMPT_FIELD_ID,
        style: TextInputStyle.Paragraph,
        labelKey: "commands.learn.history.prompt_modal_label",
        placeholder: "commands.learn.history.prompt_modal_placeholder",
        required: false,
        maxLength: 4000,
        value: defaultPrompt,
      },
    ],
  };
}

// Empty channel list means every channel is included rather than none, because omitting channels leaves extraction
// unscoped.
export function readExtractionChannelIds(multiValues: Readonly<Record<string, string[]>> | undefined): string[] {
  const picked = multiValues?.[EXTRACTION_CHANNELS_FIELD_ID] ?? [];
  return [...new Set(picked.filter((id) => DISCORD_SNOWFLAKE_PATTERN.test(id)))];
}

// In-character mode excludes attributes, memories, and RAG chunks from this modal because
// composeInCharacterSystemPrompt appends them per window later.
async function promptForExtractionSystem(
  host: ChatInputCommandInteraction,
  locale: string,
  mode: ExtractionPromptMode,
  personaForInCharacter?: TomoriState | null,
): Promise<{ submitInteraction: ModalSubmitInteraction; systemPrompt: string; channelDiscIds: string[] } | null> {
  let defaultPrompt: string;
  if (mode === "in_character") {
    defaultPrompt = substituteInCharacterFraming(
      EXTRACTION_IN_CHARACTER_SYSTEM_PROMPT,
      personaForInCharacter?.persona_nickname ?? "",
    );
  } else if (mode === "roleplay") {
    defaultPrompt = EXTRACTION_ROLEPLAY_SYSTEM_PROMPT;
  } else {
    defaultPrompt = EXTRACTION_CONVERSATION_SYSTEM_PROMPT;
  }

  const modalResult = await promptWithRawModal(
    host,
    locale,
    buildExtractionPromptModal(defaultPrompt, host.guildId !== null),
  );

  if (modalResult.outcome !== "submit" || !modalResult.interaction) return null;
  const systemPrompt = modalResult.values?.[EXTRACTION_PROMPT_FIELD_ID]?.trim() || defaultPrompt;
  return {
    submitInteraction: modalResult.interaction,
    systemPrompt,
    channelDiscIds: readExtractionChannelIds(modalResult.multiValues),
  };
}

function splitIntoWindows(lines: string[], windowSize: number): string[] {
  const windows: string[] = [];
  for (let i = 0; i < lines.length; i += windowSize) {
    windows.push(lines.slice(i, i + windowSize).join("\n"));
  }
  return windows;
}

// Provider errors stay uncollapsed here so runIncrementalExtraction can distinguish a failed window from an empty
// one.
async function extractWindow(
  windowText: string,
  previousRestatements: string[],
  provider: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  endpointUrl?: string,
  onUsage?: (usage: TokenUsage) => void,
): Promise<HistoryExtractionOutcome> {
  const userPrompt = buildExtractionUserPrompt(windowText, previousRestatements);
  return await extractHistoryWindowForProvider({
    providerName: provider,
    apiKey,
    model,
    endpointUrl,
    systemPrompt,
    userPrompt,
    temperature: 0.3,
    maxOutputTokens: 8192,
    onUsage,
  });
}

// Null return means raw fetch yielded zero messages, so batches emptied by filtering still carry boundary metadata
// for pagination.
async function fetchAndFormatMessages(params: {
  channel: TextBasedChannel;
  startMessageId: string;
  endMessageId: string | null;
  limit: number;
  allPersonas: TomoriState[];
  replyInteraction: HistoryImportStatusTarget;
  locale: string;
}): Promise<{
  formattedResult: ReturnType<typeof formatMessagesForExtraction>;
  firstMessage: Message;
  lastMessage: Message;
  reachedEnd: boolean;
} | null> {
  const { channel, startMessageId, endMessageId, limit, allPersonas, replyInteraction, locale } = params;

  await replaceHistoryImportStatus(replyInteraction, locale, {
    descriptionKey: "commands.learn.history.progress_fetching",
    color: ColorCode.INFO,
  });

  // When endMessageId is set we override the user limit and reach the full 100 so we can
  // find the anchor anywhere in the window; the trim below shrinks back to the real span.
  const effectiveLimit = endMessageId ? 100 : limit;
  const fetchResult = await fetchHistoryAfter(channel, startMessageId, effectiveLimit);
  if (fetchResult.messages.length === 0) {
    await replaceHistoryImportStatus(replyInteraction, locale, {
      titleKey: "commands.learn.history.no_messages_title",
      descriptionKey: "commands.learn.history.no_messages_description",
      color: ColorCode.WARN,
    });
    return null;
  }

  let messages = fetchResult.messages;
  let reachedEnd = fetchResult.reachedEnd;

  if (endMessageId) {
    const endIdx = messages.findIndex((m) => m.id === endMessageId);
    if (endIdx === -1) {
      await replaceHistoryImportStatus(replyInteraction, locale, {
        titleKey: "commands.learn.history.end_too_far_title",
        descriptionKey: "commands.learn.history.end_too_far_description",
        descriptionVars: { end_message_id: endMessageId },
        color: ColorCode.ERROR,
      });
      return null;
    }
    messages = messages.slice(0, endIdx + 1);
    // User-defined endpoint; channel may have more after it, so don't claim channel-end.
    reachedEnd = false;
  }

  await Promise.all(messages.map(verifyMessageWebhook));
  const formattedResult = formatMessagesForExtraction(messages, allPersonas, channel.client.user?.id);

  return {
    formattedResult,
    firstMessage: messages[0],
    lastMessage: messages[messages.length - 1],
    reachedEnd,
  };
}

// Must run after preflight validation right before document creation so failed credential, model, or scope checks do
// not burn a daily quota slot.
async function reserveDocumentQuotaForImport(
  userId: string,
  replyInteraction: HistoryImportStatusTarget,
  locale: string,
): Promise<boolean> {
  const quotaReserve = reserveDocumentQuota(userId);
  if (quotaReserve.allowed) return true;

  const resetTime = quotaReserve.resetAt ? new Date(quotaReserve.resetAt).toLocaleString(locale) : "unknown";
  await replaceHistoryImportStatus(replyInteraction, locale, {
    titleKey: "rate_limit.error_quota_exceeded_title",
    descriptionKey: "rate_limit.error_quota_exceeded_description",
    descriptionVars: { reset_time: resetTime },
    color: ColorCode.ERROR,
  });
  return false;
}

async function createDocumentForImport(params: {
  documentName: string;
  serverId: number;
  personaId: number | null;
  uploaderUserId: number | null;
  channelDiscIds: string[];
  scopeLabel: string;
  replyInteraction: HistoryImportStatusTarget;
  locale: string;
}): Promise<number | null> {
  const { documentName, serverId, personaId, uploaderUserId, channelDiscIds, scopeLabel, replyInteraction, locale } =
    params;

  const memoryLimits = getMemoryLimits();

  if (await serverMemoryRepository.documentExistsByName(serverId, personaId, documentName)) {
    await replaceHistoryImportStatus(replyInteraction, locale, {
      titleKey: "commands.learn.history.duplicate_title",
      descriptionKey: "commands.learn.history.duplicate_description",
      descriptionVars: { name: documentName },
      color: ColorCode.ERROR,
    });
    return null;
  }

  const docCount = await serverMemoryRepository.countDocumentsScoped(serverId, personaId);
  if (docCount >= memoryLimits.maxDocumentsPerServer) {
    await replaceHistoryImportStatus(replyInteraction, locale, {
      titleKey: "commands.learn.history.limit_exceeded_title",
      descriptionKey: "commands.learn.history.limit_exceeded_description",
      descriptionVars: {
        current_count: docCount.toString(),
        max_allowed: memoryLimits.maxDocumentsPerServer.toString(),
        scope: scopeLabel,
      },
      color: ColorCode.ERROR,
    });
    return null;
  }

  const currentChunkCount = await serverMemoryRepository.countChunksScoped(serverId, personaId);
  if (currentChunkCount >= memoryLimits.maxDocumentChunksPerServer) {
    await replaceHistoryImportStatus(replyInteraction, locale, {
      titleKey: "commands.learn.history.server_chunk_limit_title",
      descriptionKey: "commands.learn.history.server_chunk_limit_description",
      descriptionVars: {
        scope: scopeLabel,
        max_chunks: memoryLimits.maxDocumentChunksPerServer.toString(),
      },
      color: ColorCode.ERROR,
    });
    return null;
  }

  return await createDocumentRecord({
    serverId,
    personaId,
    uploaderUserId,
    documentName,
    sourceType: "history",
    channelDiscIds,
  });
}

// extraction-failed triggers only when at least one window errors and none yield facts, so the terminal embed can
// surface the provider error.
type IncrementalExtractionResult =
  | { ok: true; totalFactCount: number; allChunkText: string }
  | { ok: false; reason: "no-facts" }
  | { ok: false; reason: "extraction-failed"; error: string; failedWindows: number; totalWindows: number }
  | { ok: false; reason: "provider-denied"; denied: ProviderRequestDeniedError };

// Each window embeds and persists immediately rather than batching at the end to survive timeouts, so callers must
// clean up documents on failure.
async function runIncrementalExtraction(params: {
  formattedResult: ReturnType<typeof formatMessagesForExtraction>;
  provider: string;
  model: string;
  apiKey: string;
  endpointUrl?: string;
  composeSystemPrompt: (windowText: string, windowIndex: number) => Promise<string>;
  replyInteraction: HistoryImportStatusTarget;
  locale: string;
  writeTargets: WriteTarget[];
  embeddingModelId: number;
  embeddingFamily: string;
  embeddingProvider: string;
  embeddingCodename: string;
  embeddingApiKey: string;
  embeddingUsageContext?: ProviderUsageContext;
  textUsageContext?: ProviderUsageContext;
}): Promise<IncrementalExtractionResult> {
  const {
    formattedResult,
    provider,
    model,
    apiKey,
    endpointUrl,
    composeSystemPrompt,
    replyInteraction,
    locale,
    writeTargets,
    embeddingModelId,
    embeddingFamily,
    embeddingProvider,
    embeddingCodename,
    embeddingApiKey,
    embeddingUsageContext,
    textUsageContext,
  } = params;

  const memoryLimits = getMemoryLimits();
  const messageLines = formattedResult.text.split("\n");
  const windows = splitIntoWindows(messageLines, HISTORY_EXTRACTION_WINDOW_SIZE);
  const allChunks: string[] = [];
  let previousRestatements: string[] = [];
  // Only the first provider error is kept because structured-output failures repeat identically on every window.
  let failedWindows = 0;
  let firstExtractionError: string | null = null;
  let discardedEntries = 0;
  const chunkStartIndex = new Map<number, number>();
  for (const t of writeTargets) chunkStartIndex.set(t.documentId, 0);

  const baselineChunkCounts = new Map<number, number>();
  for (const t of writeTargets) {
    baselineChunkCounts.set(t.documentId, await serverMemoryRepository.countChunksScoped(t.dbServerId, t.personaId));
  }

  for (let i = 0; i < windows.length; i++) {
    await replaceHistoryImportStatus(replyInteraction, locale, {
      descriptionKey: "commands.learn.history.progress_extracting",
      descriptionVars: {
        message_count: formattedResult.messageCount.toString(),
        current: (i + 1).toString(),
        total: windows.length.toString(),
      },
      color: ColorCode.INFO,
    });

    const composedSystemPrompt = await composeSystemPrompt(windows[i], i);
    const windowOutcome = await withProviderUsageContext(textUsageContext, async () =>
      extractWindow(
        windows[i],
        previousRestatements,
        provider,
        model,
        apiKey,
        composedSystemPrompt,
        endpointUrl,
        createProviderUsageRecorder(textUsageContext, model),
      ),
    );

    const deniedExtraction = windowOutcome.ok
      ? null
      : findProviderRequestDeniedError(windowOutcome.cause, textUsageContext);
    if (deniedExtraction) return { ok: false, reason: "provider-denied", denied: deniedExtraction };

    // A failed window is recorded and skipped rather than treated as "found nothing",
    // so the run can still report the real cause if no window ever succeeds.
    if (!windowOutcome.ok) {
      failedWindows++;
      firstExtractionError ??= windowOutcome.error;
      continue;
    }

    discardedEntries += windowOutcome.discarded;

    const windowEntries = windowOutcome.entries;
    if (windowEntries.length > 0) {
      const windowChunks = windowEntries.map((e) => e.lossless_restatement);

      const wouldExceedLimit = writeTargets.some((t) => {
        const baseline = baselineChunkCounts.get(t.documentId) ?? 0;
        return baseline + allChunks.length + windowChunks.length > memoryLimits.maxDocumentChunksPerServer;
      });
      if (wouldExceedLimit) {
        log.warn(`Chunk limit reached during history import; stopping after ${allChunks.length} chunks`);
        break;
      }

      allChunks.push(...windowChunks);

      let embeddings: number[][];
      try {
        embeddings = await withProviderUsageContext(embeddingUsageContext, async () =>
          generateEmbeddingsBatched({
            provider: embeddingProvider,
            apiKey: embeddingApiKey,
            model: embeddingCodename,
            modelId: embeddingModelId,
            inputs: windowChunks,
            taskType: (await providerSupportsEmbeddingTaskType(embeddingProvider)) ? "RETRIEVAL_DOCUMENT" : undefined,
            batchSize: 16,
            onUsage: createProviderUsageRecorder(embeddingUsageContext, embeddingCodename),
          }),
        );
      } catch (error) {
        const deniedEmbedding = findProviderRequestDeniedError(error, embeddingUsageContext);
        if (deniedEmbedding) return { ok: false, reason: "provider-denied", denied: deniedEmbedding };
        throw error;
      }

      for (const target of writeTargets) {
        const startIdx = chunkStartIndex.get(target.documentId) ?? 0;
        await appendDocumentChunks({
          documentId: target.documentId,
          documentName: target.documentName,
          serverId: target.dbServerId,
          embeddingModelId,
          embeddingFamily,
          startIndex: startIdx,
          chunks: windowChunks,
          embeddings,
        });
        chunkStartIndex.set(target.documentId, startIdx + windowChunks.length);
      }

      previousRestatements = windowEntries.slice(-DEDUP_CONTEXT_COUNT).map((e) => e.lossless_restatement);
    }
  }

  if (allChunks.length === 0) {
    if (firstExtractionError !== null) {
      return {
        ok: false,
        reason: "extraction-failed",
        error: firstExtractionError,
        failedWindows,
        totalWindows: windows.length,
      };
    }
    // Every window "succeeded" yet nothing survived validation: that is a malformed-output
    // problem, not an empty conversation, so it must not read as "no facts found".
    if (discardedEntries > 0) {
      return {
        ok: false,
        reason: "extraction-failed",
        error: `The model returned ${discardedEntries} fact(s), none of which were in a usable format.`,
        failedWindows: windows.length,
        totalWindows: windows.length,
      };
    }
    return { ok: false, reason: "no-facts" };
  }

  if (discardedEntries > 0) {
    log.warn(
      `History import kept ${allChunks.length} facts but discarded ${discardedEntries} malformed ` +
        `entries across ${windows.length} window(s).`,
    );
  }

  return { ok: true, totalFactCount: allChunks.length, allChunkText: allChunks.join("\n\n") };
}

interface HistoryImportNotice {
  titleKey: string;
  descriptionKey?: string;
  description?: string;
  descriptionVars?: Record<string, string>;
}

interface HistoryImportRuntime {
  textCreds: ResolvedCredentials;
  embeddingCreds: ResolvedCredentials;
  embeddingModel: NonNullable<Awaited<ReturnType<typeof llmModelRepo.loadEmbeddingModelById>>>;
  embeddingParams: {
    embeddingModelId: number;
    embeddingFamily: string;
    embeddingProvider: string;
    embeddingCodename: string;
    embeddingApiKey: string;
    embeddingUsageContext?: ProviderUsageContext;
  };
  provider: string;
  model: string;
  endpointUrl: string | undefined;
}

type HistoryImportRuntimeResult =
  | { ok: true; runtime: HistoryImportRuntime }
  | { ok: false; notice: HistoryImportNotice };

async function resolveHistoryImportRuntime(
  tomoriState: TomoriState,
  userId: number | null,
  locale: string,
): Promise<HistoryImportRuntimeResult> {
  let textCreds: ResolvedCredentials;
  let embeddingCreds: ResolvedCredentials;
  try {
    [textCreds, embeddingCreds] = await Promise.all([
      resolveCapabilityCredentials(tomoriState.server_id, "text", { userId }),
      resolveCapabilityCredentials(tomoriState.server_id, "embedding", { userId }),
    ]);
  } catch (error) {
    const denied = findProviderRequestDeniedError(error);
    if (denied) {
      const copy = getProviderRequestFailureCopy(denied, locale);
      log.warn(`[Learn History] Provider denied a text or embedding request`, error, {
        userId,
        serverId: tomoriState.server_id,
        personaId: tomoriState.persona_id,
        metadata: {
          command: "learn history",
        },
      });
      return { ok: false, notice: { titleKey: copy.titleKey, description: copy.description } };
    }
    if (error instanceof PersonalProviderRequiredError) {
      log.warn(`[Learn History] Personal provider required for capability "text" or "embedding"`, error, {
        userId,
        serverId: tomoriState.server_id,
        personaId: tomoriState.persona_id,
        metadata: {
          command: "learn history",
        },
      });
      return {
        ok: false,
        notice: {
          titleKey: "general.errors.personal_provider_required_title",
          descriptionKey: "general.errors.personal_provider_required_description",
        },
      };
    }
    if (error instanceof CredentialUnavailableError && error.source === "personal") {
      log.warn(`[Learn History] Personal provider credentials unavailable: ${error.reason}`, error, {
        userId,
        serverId: tomoriState.server_id,
        personaId: tomoriState.persona_id,
        metadata: {
          command: "learn history",
          reason: error.reason,
        },
      });
      return {
        ok: false,
        notice: {
          titleKey: "general.errors.api_key_error_title",
          descriptionKey: "general.errors.personal_provider_credentials_error_description",
        },
      };
    }
    throw error;
  }

  const embeddingModelId =
    getResolvedCapabilityModelId(embeddingCreds, "embedding") ?? tomoriState.config.embedding_model_id;
  if (!embeddingModelId) {
    log.warn(`[Learn History] No embedding model configured for server ${tomoriState.server_id}`, undefined, {
      userId,
      serverId: tomoriState.server_id,
      personaId: tomoriState.persona_id,
      metadata: {
        command: "learn history",
      },
    });
    return {
      ok: false,
      notice: {
        titleKey: "commands.learn.history.no_embedding_model_title",
        descriptionKey: "commands.learn.history.no_embedding_model_description",
      },
    };
  }
  const embeddingModel = await llmModelRepo.loadEmbeddingModelById(embeddingModelId);
  if (!embeddingModel) {
    log.warn(
      `[Learn History] Embedding model ${embeddingModelId} not found in catalog for server ${tomoriState.server_id}`,
      undefined,
      {
        userId,
        serverId: tomoriState.server_id,
        personaId: tomoriState.persona_id,
        metadata: {
          command: "learn history",
          embeddingModelId,
        },
      },
    );
    return {
      ok: false,
      notice: {
        titleKey: "commands.learn.history.no_embedding_model_title",
        descriptionKey: "commands.learn.history.no_embedding_model_description",
      },
    };
  }

  const textState = await resolveTextCredentialState(tomoriState, textCreds);
  return {
    ok: true,
    runtime: {
      textCreds,
      embeddingCreds,
      embeddingModel,
      embeddingParams: {
        embeddingModelId,
        embeddingFamily: embeddingModel.model_family,
        embeddingProvider: embeddingModel.provider as string,
        embeddingCodename: embeddingModel.codename,
        embeddingApiKey: embeddingCreds.apiKey,
        embeddingUsageContext: embeddingCreds.usageContext,
      },
      provider: textCreds.provider,
      model: getEffectiveLlmModelName(textState.llm, textState.config.custom_model_name),
      endpointUrl: textCreds.customEndpoint?.endpoint_url,
    },
  };
}

async function validateHistoryMessageRange(
  channel: NonNullable<ChatInputCommandInteraction["channel"]>,
  startMessageId: string,
  endMessageId: string | null,
): Promise<HistoryImportNotice | null> {
  try {
    await channel.messages.fetch(startMessageId);
  } catch {
    return {
      titleKey: "commands.learn.history.invalid_start_id_title",
      descriptionKey: "commands.learn.history.invalid_start_id_description",
      descriptionVars: { start_message_id: startMessageId },
    };
  }

  if (!endMessageId) return null;
  try {
    await channel.messages.fetch(endMessageId);
  } catch {
    return {
      titleKey: "commands.learn.history.invalid_end_id_title",
      descriptionKey: "commands.learn.history.invalid_end_id_description",
      descriptionVars: { end_message_id: endMessageId },
    };
  }

  try {
    if (BigInt(endMessageId) <= BigInt(startMessageId)) {
      return {
        titleKey: "commands.learn.history.end_not_after_start_title",
        descriptionKey: "commands.learn.history.end_not_after_start_description",
      };
    }
  } catch {
    return {
      titleKey: "commands.learn.history.invalid_end_id_title",
      descriptionKey: "commands.learn.history.invalid_end_id_description",
      descriptionVars: { end_message_id: endMessageId },
    };
  }
  return null;
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const sourceChannel = interaction.channel;
  const learnerInput = interaction.options.getString("learner")?.trim() || null;
  const scope = resolveLearnerScope(learnerInput);

  let tomoriState: TomoriState | null = null;
  let modalSubmitInteraction: ModalSubmitInteraction | undefined;
  let selectedPersonaId: number | undefined;

  try {
    if (!isRagAvailable()) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.shared.rag.disabled_title",
        descriptionKey: "commands.shared.rag.disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const memCheck = memoryGuard.checkMemory();
    if (memCheck.status === "critical") {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "rate_limit.error_memory_critical_title",
        descriptionKey: "rate_limit.error_memory_critical_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const isDMChannel = !interaction.guildId;
    const hasManagePermission = isDMChannel || (interaction.memberPermissions?.has("ManageGuild") ?? false);
    if (!hasManagePermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.learn.history.no_permission_title",
        descriptionKey: "commands.learn.history.no_permission_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guild?.id ?? interaction.user.id;
    tomoriState = await getCachedTomoriState(guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const overlayResult = await applyPersonalProviderSelectionsToTomoriState(tomoriState, userData.user_id ?? null);
    tomoriState = overlayResult.tomoriState;

    const effectiveModelName = getEffectiveLlmModelName(tomoriState.llm, tomoriState.config.custom_model_name);

    if (!tomoriState.llm.supports_structoutput) {
      log.warn(`[Learn History] Model "${effectiveModelName}" does not support structured output`, undefined, {
        userId: userData.user_id,
        serverId: tomoriState.server_id,
        personaId: tomoriState.persona_id,
        metadata: {
          command: "learn history",
          provider: tomoriState.llm.llm_provider,
          model: effectiveModelName,
        },
      });
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.learn.history.model_incompatible_title",
        descriptionKey: "commands.learn.history.model_incompatible_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!providerSupportsFeature(tomoriState.llm.llm_provider, "historyExtraction")) {
      log.warn(
        `[Learn History] Provider "${tomoriState.llm.llm_provider}" does not support history extraction`,
        undefined,
        {
          userId: userData.user_id,
          serverId: tomoriState.server_id,
          personaId: tomoriState.persona_id,
          metadata: {
            command: "learn history",
            provider: tomoriState.llm.llm_provider,
            model: effectiveModelName,
          },
        },
      );
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.provider_not_supported_title",
        descriptionKey: "general.errors.provider_not_supported_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nameInput = interaction.options.getString("name", true).trim();
    const startMessageId = interaction.options.getString("start_message_id", true).trim();
    const endMessageId = interaction.options.getString("end_message_id")?.trim() || null;
    const promptModeInput = interaction.options.getString("prompt");
    const promptMode: ExtractionPromptMode =
      promptModeInput === "roleplay"
        ? "roleplay"
        : promptModeInput === "in_character"
          ? "in_character"
          : "conversation";
    const messageFetchLimit = interaction.options.getInteger("limit") ?? 100;

    // In-character extraction requires a single persona's identity to do its job:
    // reject global/automatic combinations rather than silently degrading.
    if (promptMode === "in_character" && scope !== "persona") {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.learn.history.in_character_scope_invalid_title",
        descriptionKey: "commands.learn.history.in_character_scope_invalid_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const allPersonas = await personaRepository.loadAllForServer(guildId);

    if (scope === "persona") {
      const selectedPersona = learnerInput === null ? tomoriState : resolveSelectedPersona(allPersonas, learnerInput);
      const targetPersonaId = selectedPersona?.persona_id;
      if (!selectedPersona || !targetPersonaId) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.learn.history.learner_unresolved_title",
          descriptionKey: "commands.learn.history.learner_unresolved_description",
          descriptionVars: { learner: learnerInput ?? "" },
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      selectedPersonaId = targetPersonaId;

      const promptModalResult = await promptForExtractionSystem(interaction, locale, promptMode, selectedPersona);
      if (!promptModalResult) return;
      modalSubmitInteraction = promptModalResult.submitInteraction;
      const personaSystemPrompt = promptModalResult.systemPrompt;
      const channelDiscIds = promptModalResult.channelDiscIds;

      await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      const runtimeResult = await resolveHistoryImportRuntime(tomoriState, userData.user_id ?? null, locale);
      if (!runtimeResult.ok) {
        await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
          ...runtimeResult.notice,
          color: ColorCode.ERROR,
        });
        return;
      }

      const rangeError = await validateHistoryMessageRange(sourceChannel, startMessageId, endMessageId);
      if (rangeError) {
        await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
          ...rangeError,
          color: ColorCode.ERROR,
        });
        return;
      }

      const { textCreds, embeddingCreds, embeddingModel, embeddingParams, provider, model, endpointUrl } =
        runtimeResult.runtime;
      const scopeLabel = localizer(locale, "commands.learn.history.scope_label_persona", {
        persona_name: selectedPersona.persona_nickname,
      });
      const fetchResult = await fetchAndFormatMessages({
        channel: sourceChannel,
        startMessageId,
        endMessageId,
        limit: messageFetchLimit,
        allPersonas,
        replyInteraction: modalSubmitInteraction,
        locale,
      });
      if (!fetchResult) return;

      const inCharacterFilterIds =
        channelDiscIds.length > 0
          ? channelDiscIds
          : channelScopeCandidates(sourceChannel.id, sourceChannel.isThread() ? sourceChannel.parentId : null);
      const personaServerId = tomoriState.server_id;
      const inCharacterExistingMemories =
        promptMode === "in_character"
          ? await loadInCharacterMemoryLines(
              personaServerId,
              selectedPersona.persona_lineage_id ?? null,
              inCharacterFilterIds,
            )
          : [];
      const composeSystemPrompt =
        promptMode === "in_character"
          ? async (windowText: string): Promise<string> => {
              const retrievedChunks = await retrieveInCharacterChunks({
                serverId: personaServerId,
                personaId: targetPersonaId,
                query: windowText,
                embeddingModel,
                embeddingApiKey: embeddingCreds.apiKey,
                filterChannelIds: inCharacterFilterIds,
                maxResults: HISTORY_INCHARACTER_RAG_MAX_RESULTS,
              });
              return composeInCharacterSystemPrompt({
                framingTemplate: personaSystemPrompt,
                personaNickname: selectedPersona.persona_nickname,
                personaPrompt: selectedPersona.persona_prompt ?? null,
                attributes: selectedPersona.attribute_list ?? [],
                existingMemoryLines: inCharacterExistingMemories,
                retrievedChunks,
              });
            }
          : async (): Promise<string> => personaSystemPrompt;
      const footer = buildFooter({
        firstMessage: fetchResult.firstMessage,
        lastMessage: fetchResult.lastMessage,
        reachedEnd: fetchResult.reachedEnd,
        guildId: interaction.guild?.id ?? null,
        channelId: sourceChannel.id,
        locale,
      });

      if (fetchResult.formattedResult.messageCount === 0) {
        await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
          titleKey: "commands.learn.history.no_extractable_content_title",
          description: `${localizer(locale, "commands.learn.history.no_extractable_content_description")}\n\n${footer}`,
          color: ColorCode.WARN,
        });
        return;
      }
      if (!(await reserveDocumentQuotaForImport(interaction.user.id, modalSubmitInteraction, locale))) {
        return;
      }

      const documentId = await createDocumentForImport({
        documentName: nameInput,
        serverId: tomoriState.server_id,
        personaId: targetPersonaId,
        uploaderUserId: userData.user_id ?? null,
        channelDiscIds,
        scopeLabel,
        replyInteraction: modalSubmitInteraction,
        locale,
      });
      if (documentId === null) return;

      const extractResult = await runIncrementalExtraction({
        formattedResult: fetchResult.formattedResult,
        provider,
        model,
        apiKey: textCreds.apiKey,
        textUsageContext: textCreds.usageContext,
        endpointUrl,
        composeSystemPrompt,
        replyInteraction: modalSubmitInteraction,
        locale,
        writeTargets: [
          { documentId, documentName: nameInput, dbServerId: tomoriState.server_id, personaId: targetPersonaId },
        ],
        ...embeddingParams,
      });
      if (!extractResult.ok) {
        await serverMemoryRepository.removeDocument(documentId, tomoriState.server_id, targetPersonaId);
        await showExtractionFailureTerminal(modalSubmitInteraction, locale, footer, extractResult);
        return;
      }

      await finalizeDocumentContent(documentId, extractResult.allChunkText);
      invalidateTomoriStateCache(guildId);
      await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
        titleKey: "commands.learn.history.success_title",
        description: `${localizer(locale, "commands.learn.history.success_description", {
          fact_count: extractResult.totalFactCount.toString(),
          message_count: fetchResult.formattedResult.messageCount.toString(),
          name: nameInput,
          chunk_count: extractResult.totalFactCount.toString(),
          scope: scopeLabel,
        })}\n\n${footer}`,
        color: ColorCode.SUCCESS,
      });
      return;
    }

    if (scope === "global") {
      const scopeLabel = localizer(locale, "commands.learn.history.scope_label_global");

      const promptModalResult = await promptForExtractionSystem(interaction, locale, promptMode);
      if (!promptModalResult) return;
      modalSubmitInteraction = promptModalResult.submitInteraction;
      const globalSystemPrompt = promptModalResult.systemPrompt;
      const channelDiscIds = promptModalResult.channelDiscIds;

      await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      const runtimeResult = await resolveHistoryImportRuntime(tomoriState, userData.user_id ?? null, locale);
      if (!runtimeResult.ok) {
        await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
          ...runtimeResult.notice,
          color: ColorCode.ERROR,
        });
        return;
      }

      const rangeError = await validateHistoryMessageRange(sourceChannel, startMessageId, endMessageId);
      if (rangeError) {
        await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
          ...rangeError,
          color: ColorCode.ERROR,
        });
        return;
      }

      const { textCreds, embeddingParams, provider, model, endpointUrl } = runtimeResult.runtime;

      const fetchResult = await fetchAndFormatMessages({
        channel: interaction.channel,
        startMessageId,
        endMessageId,
        limit: messageFetchLimit,
        allPersonas,
        replyInteraction: modalSubmitInteraction,
        locale,
      });
      if (!fetchResult) return;

      const footer = buildFooter({
        firstMessage: fetchResult.firstMessage,
        lastMessage: fetchResult.lastMessage,
        reachedEnd: fetchResult.reachedEnd,
        guildId: interaction.guild?.id ?? null,
        channelId: interaction.channel.id,
        locale,
      });

      if (fetchResult.formattedResult.messageCount === 0) {
        await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
          titleKey: "commands.learn.history.no_extractable_content_title",
          description: `${localizer(locale, "commands.learn.history.no_extractable_content_description")}\n\n${footer}`,
          color: ColorCode.WARN,
        });
        return;
      }

      if (!(await reserveDocumentQuotaForImport(interaction.user.id, modalSubmitInteraction, locale))) return;

      const documentId = await createDocumentForImport({
        documentName: nameInput,
        serverId: tomoriState.server_id,
        personaId: null,
        uploaderUserId: userData.user_id ?? null,
        channelDiscIds,
        scopeLabel,
        replyInteraction: modalSubmitInteraction,
        locale,
      });
      if (documentId === null) return;

      const extractResult = await runIncrementalExtraction({
        formattedResult: fetchResult.formattedResult,
        provider,
        model,
        apiKey: textCreds.apiKey,
        textUsageContext: textCreds.usageContext,
        endpointUrl,
        composeSystemPrompt: async () => globalSystemPrompt,
        replyInteraction: modalSubmitInteraction,
        locale,
        writeTargets: [{ documentId, documentName: nameInput, dbServerId: tomoriState.server_id, personaId: null }],
        ...embeddingParams,
      });

      if (!extractResult.ok) {
        await serverMemoryRepository.removeDocument(documentId, tomoriState.server_id, null);
        await showExtractionFailureTerminal(modalSubmitInteraction, locale, footer, extractResult);
        return;
      }

      await finalizeDocumentContent(documentId, extractResult.allChunkText);
      invalidateTomoriStateCache(guildId);

      await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
        titleKey: "commands.learn.history.success_title",
        description: `${localizer(locale, "commands.learn.history.success_description", {
          fact_count: extractResult.totalFactCount.toString(),
          message_count: fetchResult.formattedResult.messageCount.toString(),
          name: nameInput,
          chunk_count: extractResult.totalFactCount.toString(),
          scope: scopeLabel,
        })}\n\n${footer}`,
        color: ColorCode.SUCCESS,
      });
      return;
    }

    // Automatic scope creates per-persona documents before extraction so each
    // webhook author's chunks can be written incrementally.
    const autoPromptModalResult = await promptForExtractionSystem(interaction, locale, promptMode);
    if (!autoPromptModalResult) return;
    modalSubmitInteraction = autoPromptModalResult.submitInteraction;
    const autoSystemPrompt = autoPromptModalResult.systemPrompt;
    const channelDiscIds = autoPromptModalResult.channelDiscIds;

    await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    const runtimeResult = await resolveHistoryImportRuntime(tomoriState, userData.user_id ?? null, locale);
    if (!runtimeResult.ok) {
      await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
        ...runtimeResult.notice,
        color: ColorCode.ERROR,
      });
      return;
    }

    const rangeError = await validateHistoryMessageRange(sourceChannel, startMessageId, endMessageId);
    if (rangeError) {
      await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
        ...rangeError,
        color: ColorCode.ERROR,
      });
      return;
    }

    const { textCreds, embeddingParams, provider, model, endpointUrl } = runtimeResult.runtime;

    const fetchResult = await fetchAndFormatMessages({
      channel: interaction.channel,
      startMessageId,
      endMessageId,
      limit: messageFetchLimit,
      allPersonas,
      replyInteraction: modalSubmitInteraction,
      locale,
    });
    if (!fetchResult) return;

    const { formattedResult } = fetchResult;
    const detectedTomoriIds = formattedResult.detectedPersonaTomoriIds;

    const footer = buildFooter({
      firstMessage: fetchResult.firstMessage,
      lastMessage: fetchResult.lastMessage,
      reachedEnd: fetchResult.reachedEnd,
      guildId: interaction.guild?.id ?? null,
      channelId: interaction.channel.id,
      locale,
    });

    if (formattedResult.messageCount === 0) {
      await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
        titleKey: "commands.learn.history.no_extractable_content_title",
        description: `${localizer(locale, "commands.learn.history.no_extractable_content_description")}\n\n${footer}`,
        color: ColorCode.WARN,
      });
      return;
    }

    if (detectedTomoriIds.length === 0) {
      const scopeLabel = localizer(locale, "commands.learn.history.scope_label_global");

      if (!(await reserveDocumentQuotaForImport(interaction.user.id, modalSubmitInteraction, locale))) return;

      const documentId = await createDocumentForImport({
        documentName: nameInput,
        serverId: tomoriState.server_id,
        personaId: null,
        uploaderUserId: userData.user_id ?? null,
        channelDiscIds,
        scopeLabel,
        replyInteraction: modalSubmitInteraction,
        locale,
      });
      if (documentId === null) return;

      const extractResult = await runIncrementalExtraction({
        formattedResult,
        provider,
        model,
        apiKey: textCreds.apiKey,
        textUsageContext: textCreds.usageContext,
        endpointUrl,
        composeSystemPrompt: async () => autoSystemPrompt,
        replyInteraction: modalSubmitInteraction,
        locale,
        writeTargets: [{ documentId, documentName: nameInput, dbServerId: tomoriState.server_id, personaId: null }],
        ...embeddingParams,
      });

      if (!extractResult.ok) {
        await serverMemoryRepository.removeDocument(documentId, tomoriState.server_id, null);
        await showExtractionFailureTerminal(modalSubmitInteraction, locale, footer, extractResult);
        return;
      }

      await finalizeDocumentContent(documentId, extractResult.allChunkText);
      invalidateTomoriStateCache(guildId);

      await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
        titleKey: "commands.learn.history.success_title",
        description: `${localizer(locale, "commands.learn.history.success_automatic_global_fallback", {
          name: nameInput,
        })}\n\n${footer}`,
        color: ColorCode.SUCCESS,
      });
      return;
    }

    if (!(await reserveDocumentQuotaForImport(interaction.user.id, modalSubmitInteraction, locale))) return;

    const memoryLimits = getMemoryLimits();
    const personaTargets: Array<{ target: WriteTarget; personaNickname: string; docName: string }> = [];

    for (const personaId of detectedTomoriIds) {
      const persona = allPersonas.find((p) => p.persona_id === personaId);
      if (!persona) continue;

      const docName = `${nameInput} (${persona.persona_nickname})`;

      if (await serverMemoryRepository.documentExistsByName(tomoriState.server_id, personaId, docName)) {
        log.warn(`Skipping duplicate document "${docName}" for persona ${personaId} during automatic scope`);
        continue;
      }

      const docCount = await serverMemoryRepository.countDocumentsScoped(tomoriState.server_id, personaId);
      if (docCount >= memoryLimits.maxDocumentsPerServer) {
        log.warn(`Document limit exceeded for persona ${personaId}, skipping`);
        continue;
      }

      const chunkCount = await serverMemoryRepository.countChunksScoped(tomoriState.server_id, personaId);
      if (chunkCount >= memoryLimits.maxDocumentChunksPerServer) {
        log.warn(`Chunk limit exceeded for persona ${personaId}, skipping`);
        continue;
      }

      const documentId = await createDocumentRecord({
        serverId: tomoriState.server_id,
        personaId,
        uploaderUserId: userData.user_id ?? null,
        documentName: docName,
        sourceType: "history",
        channelDiscIds,
      });

      personaTargets.push({
        target: { documentId, documentName: docName, dbServerId: tomoriState.server_id, personaId },
        personaNickname: persona.persona_nickname,
        docName,
      });
    }

    if (personaTargets.length === 0) {
      await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
        titleKey: "commands.learn.history.duplicate_title",
        descriptionKey: "commands.learn.history.duplicate_description",
        descriptionVars: { name: nameInput },
        color: ColorCode.ERROR,
      });
      return;
    }

    const extractResult = await runIncrementalExtraction({
      formattedResult,
      provider,
      model,
      apiKey: textCreds.apiKey,
      textUsageContext: textCreds.usageContext,
      endpointUrl,
      composeSystemPrompt: async () => autoSystemPrompt,
      replyInteraction: modalSubmitInteraction,
      locale,
      writeTargets: personaTargets.map((pt) => pt.target),
      ...embeddingParams,
    });

    for (const { target } of personaTargets) {
      if (!extractResult.ok) {
        await serverMemoryRepository.removeDocument(target.documentId, tomoriState.server_id, target.personaId);
      } else {
        await finalizeDocumentContent(target.documentId, extractResult.allChunkText);
      }
    }

    if (!extractResult.ok) {
      await showExtractionFailureTerminal(modalSubmitInteraction, locale, footer, extractResult);
      return;
    }

    invalidateTomoriStateCache(guildId);

    const personaResultLines = personaTargets.map(({ personaNickname, docName }) =>
      localizer(locale, "commands.learn.history.success_automatic_persona_line", {
        persona_name: personaNickname,
        doc_name: docName,
        chunk_count: extractResult.totalFactCount.toString(),
      }),
    );

    await replaceHistoryImportStatus(modalSubmitInteraction, locale, {
      titleKey: "commands.learn.history.success_title",
      description: `${localizer(locale, "commands.learn.history.success_automatic_description", {
        fact_count: extractResult.totalFactCount.toString(),
        message_count: formattedResult.messageCount.toString(),
        persona_list: personaResultLines.join("\n"),
      })}\n\n${footer}`,
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: selectedPersonaId ?? tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "memory history import",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error in /memory history import command", error, context);

    const errorReplyTarget =
      modalSubmitInteraction && (modalSubmitInteraction.deferred || modalSubmitInteraction.replied)
        ? modalSubmitInteraction
        : interaction.deferred || interaction.replied
          ? interaction
          : null;

    if (errorReplyTarget) {
      await replyInfoEmbed(errorReplyTarget, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
