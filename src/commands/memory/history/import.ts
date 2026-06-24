/**
 * /memory history import - Extract atomic facts from channel message history using an LLM
 * and store them as document chunks for RAG retrieval.
 *
 * Inspired by SimpleMem's "Semantic Structured Compression" approach:
 * instead of summarizing chat into a blob, extract self-contained atomic facts
 * with resolved pronouns and absolute timestamps.
 *
 * Supports three scopes:
 * - persona: Store facts for a specific persona (user selects via paginated buttons)
 * - automatic: Detect personas from webhook authors, create per-persona documents
 * - global: Store facts serverwide (persona_id = NULL)
 */

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  Client,
  Message,
  SlashCommandSubcommandBuilder,
  TextBasedChannel,
} from "discord.js";
import { AttachmentBuilder, MessageFlags, EmbedBuilder, TextInputStyle } from "discord.js";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { llmModelRepo, personaRepository, serverMemoryRepository } from "@/utils/db/repositories";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { memoryGuard, reserveDocumentQuota } from "@/utils/security/rateLimiter";
import { generateEmbeddingsBatched, providerSupportsEmbeddingTaskType } from "@/utils/embeddings/embeddingProvider";
import { fetchHistoryAfter } from "@/utils/discord/historyFetcher";
import { formatMessagesForExtraction } from "@/utils/discord/historyFormatter";
import {
  createDocumentRecord,
  appendDocumentChunks,
  finalizeDocumentContent,
} from "@/utils/documents/documentService";
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
import type { HistoryMemoryEntry } from "@/providers/utils/historyExtractionSchema";
import type { EmbeddingModelRow, ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { extractHistoryWindowForProvider } from "@/providers/utils/providerFeatureExecutors";
import { providerSupportsFeature } from "@/utils/provider/providerInfoRegistry";
import { getEffectiveLlmModelName } from "@/utils/provider/modelDisplay";
import {
  CredentialUnavailableError,
  getResolvedCapabilityModelId,
  PersonalProviderRequiredError,
  type ResolvedCredentials,
  resolveCapabilityCredentials,
} from "@/utils/provider/credentialResolver";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";

/** Maximum document name length */
const MAX_DOCUMENT_NAME_LENGTH = 64;

/** Number of messages per LLM extraction window */
const HISTORY_EXTRACTION_WINDOW_SIZE = Number.parseInt(process.env.HISTORY_EXTRACTION_WINDOW_SIZE || "40", 10);

/** Number of previous restatements to pass as dedup context between windows */
const DEDUP_CONTEXT_COUNT = 3;

/** Max retrieved document chunks injected into the in-character system prompt per window */
const HISTORY_INCHARACTER_RAG_MAX_RESULTS = (() => {
  const parsed = Number.parseInt(process.env.HISTORY_INCHARACTER_RAG_MAX_RESULTS || "16", 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 16;
})();

/** Minimum similarity score for chunks pulled into in-character context (loose; we're seeding awareness) */
const HISTORY_INCHARACTER_RAG_MIN_SIMILARITY = 0.3;

type HistoryScope = "persona" | "automatic" | "global";

/** Target document for incremental per-window chunk writes */
interface WriteTarget {
  documentId: number;
  dbServerId: number;
  personaId: number | null;
}

/** Per-window debug snapshot: the exact prompts sent to the extraction LLM */
interface WindowDebugSnapshot {
  windowIndex: number;
  windowMessageText: string;
  systemPrompt: string;
  userPrompt: string;
  extractedEntries: HistoryMemoryEntry[];
}

/**
 * Builds the localized footer appended to every terminal embed: range timestamps,
 * last-processed message ID, jump link, and channel-end status.
 */
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
    ? "commands.memory.history.import.end_status_reached_end"
    : "commands.memory.history.import.end_status_more_available";
  return localizer(locale, "commands.memory.history.import.success_footer", {
    first_unix: Math.floor(firstMessage.createdTimestamp / 1000).toString(),
    last_unix: Math.floor(lastMessage.createdTimestamp / 1000).toString(),
    last_message_id: lastMessage.id,
    jump_link: jumpLink,
    end_status: localizer(locale, endStatusKey),
  });
}

/**
 * Loads existing server memories for a persona, filtered by channel tags.
 * Untagged memories (no `#tag` entries) are always included; tagged memories must
 * match at least one of the provided filter tags. Tag quotes are stripped before
 * comparison (server_memories tags are stored with surrounding quotes).
 *
 * @param serverId Internal server id
 * @param personaLineageId Persona lineage id (cross-version persona identity)
 * @param filterChannelTags Channel tag names without `#` prefix (e.g. ["general", "dev"])
 */
async function loadInCharacterMemoryLines(
  serverId: number,
  personaLineageId: number | null,
  filterChannelTags: string[],
): Promise<string[]> {
  if (personaLineageId == null) return [];

  const rows = await sql<Array<{ content: string; tags: string[] | null }>>`
    SELECT content, tags
    FROM server_memories
    WHERE server_id = ${serverId}
      AND persona_lineage_id = ${personaLineageId}
    ORDER BY created_at DESC
  `;

  const lowerFilter = filterChannelTags.map((t) => t.toLowerCase());

  return rows
    .filter((row) => {
      const normalized = (row.tags ?? []).map((t) => t.replace(/^["']+|["']+$/g, ""));
      const channelTags = normalized.filter((t) => t.startsWith("#"));
      if (channelTags.length === 0) return true;
      if (lowerFilter.length === 0) return true;
      return channelTags.some((t) => lowerFilter.includes(t.slice(1).toLowerCase()));
    })
    .map((row) => row.content.trim())
    .filter((content) => content.length > 0);
}

/**
 * Retrieves document chunks relevant to a query, looping over multiple channel
 * filter tags and merging results. Each tag-filtered call returns chunks from
 * documents tagged with that channel (plus untagged documents). Results are
 * deduped by (document_id, chunk_index) and the highest-similarity copy is kept.
 *
 * NB: this makes one embedding round-trip per tag. With 16-results × 3 tags,
 * that's 3 embedding calls per extraction window. The user opted into "luxury".
 */
async function retrieveInCharacterChunks(params: {
  serverId: number;
  personaId: number | null;
  query: string;
  embeddingModel: EmbeddingModelRow;
  embeddingApiKey: string;
  filterChannelTags: string[];
  maxResults: number;
}): Promise<RetrievedDocumentChunk[]> {
  const { serverId, personaId, query, embeddingModel, embeddingApiKey, filterChannelTags, maxResults } = params;

  if (!query.trim()) return [];

  const tagsToQuery = filterChannelTags.length > 0 ? filterChannelTags : [null];
  const merged = new Map<string, RetrievedDocumentChunk>();

  for (const tag of tagsToQuery) {
    const chunks = await ragRepository.retrieveRelevantChunks({
      serverId,
      personaId,
      query,
      embeddingModel,
      apiKey: embeddingApiKey,
      maxResults,
      minSimilarity: HISTORY_INCHARACTER_RAG_MIN_SIMILARITY,
      channelName: tag,
    });

    for (const chunk of chunks) {
      const key = `${chunk.document_id}:${chunk.chunk_index}`;
      const existing = merged.get(key);
      if (!existing || chunk.similarity > existing.similarity) {
        merged.set(key, chunk);
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults);
}

/**
 * Sends the captured in-character debug snapshots as a JSON attachment via DM to
 * the invoking user. Falls back to an ephemeral follow-up on the original interaction
 * if the DM fails (closed DMs, blocked bot, etc.). Never throws — failures are logged
 * and swallowed so a debug-feature glitch doesn't tank a successful extraction.
 */
async function sendInCharacterDebugDump(params: {
  interaction: ChatInputCommandInteraction;
  locale: string;
  personaNickname: string;
  provider: string;
  model: string;
  snapshots: WindowDebugSnapshot[];
}): Promise<void> {
  const { interaction, locale, personaNickname, provider, model, snapshots } = params;

  try {
    const dump = {
      captured_at: new Date().toISOString(),
      guild_id: interaction.guild?.id ?? null,
      channel_id: interaction.channelId,
      persona_nickname: personaNickname,
      provider,
      model,
      window_count: snapshots.length,
      windows: snapshots.map((s) => ({
        window_index: s.windowIndex,
        system_prompt: s.systemPrompt,
        user_prompt: s.userPrompt,
        window_message_text: s.windowMessageText,
        extracted_count: s.extractedEntries.length,
        extracted_entries: s.extractedEntries,
      })),
    };

    const fileContent = JSON.stringify(dump, null, 2);
    const fileName = `history-import-debug-${interaction.channelId}-${Date.now()}.json`;
    const attachment = new AttachmentBuilder(Buffer.from(fileContent, "utf-8"), { name: fileName });

    const dmDescription = [
      localizer(locale, "commands.memory.history.import.debug_dm_description", {
        persona_name: personaNickname,
        window_count: snapshots.length.toString(),
      }),
      "```yaml",
      `provider: ${provider}`,
      `model: ${model}`,
      `windows: ${snapshots.length}`,
      `total_extracted: ${snapshots.reduce((sum, s) => sum + s.extractedEntries.length, 0)}`,
      "```",
    ].join("\n\n");

    try {
      await interaction.user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.memory.history.import.debug_dm_title"))
            .setDescription(dmDescription)
            .setColor(ColorCode.INFO),
        ],
        files: [attachment],
      });
    } catch (dmError) {
      log.warn(
        `Failed to DM in-character debug dump to user ${interaction.user.id}; falling back to ephemeral follow-up.`,
        dmError as Error,
      );
      try {
        await interaction.followUp({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.memory.history.import.debug_dm_failed_title"))
              .setDescription(localizer(locale, "commands.memory.history.import.debug_dm_failed_description"))
              .setColor(ColorCode.WARN),
          ],
          files: [attachment],
          flags: MessageFlags.Ephemeral,
        });
      } catch (followUpError) {
        log.warn("Failed ephemeral fallback for in-character debug dump.", followUpError as Error);
      }
    }
  } catch (error) {
    log.warn("Failed to build in-character debug dump.", error as Error);
  }
}

/** Shows the "no facts extracted from this batch" embed with the pagination footer. */
async function showNoFactsExtractedEmbed(
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  footer: string,
): Promise<void> {
  await replyInteraction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(localizer(locale, "commands.memory.history.import.no_facts_extracted_title"))
        .setDescription(
          `${localizer(locale, "commands.memory.history.import.no_facts_extracted_description")}\n\n${footer}`,
        )
        .setColor(ColorCode.WARN),
    ],
  });
}

/**
 * Configures the /memory history import subcommand options.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("import")
    .setDescription(localizer("en-US", "commands.memory.history.import.description"))
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription(localizer("en-US", "commands.memory.history.import.name_description"))
        .setRequired(true)
        .setMaxLength(MAX_DOCUMENT_NAME_LENGTH),
    )
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.memory.history.import.scope_description"))
        .addChoices(
          {
            name: localizer("en-US", "commands.memory.history.import.scope_choice_persona"),
            value: "persona",
          },
          {
            name: localizer("en-US", "commands.memory.history.import.scope_choice_automatic"),
            value: "automatic",
          },
          {
            name: localizer("en-US", "commands.memory.history.import.scope_choice_global"),
            value: "global",
          },
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("start_message_id")
        .setDescription(localizer("en-US", "commands.memory.history.import.start_message_id_description"))
        .setRequired(true)
        .setMinLength(15)
        .setMaxLength(25),
    )
    .addStringOption((option) =>
      option
        .setName("channels")
        .setDescription(localizer("en-US", "commands.memory.history.import.channels_description"))
        .setRequired(false)
        .setMaxLength(200),
    )
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription(localizer("en-US", "commands.memory.history.import.prompt_description"))
        .setRequired(false)
        .addChoices(
          {
            name: localizer("en-US", "commands.memory.history.import.prompt_choice_conversation"),
            value: "conversation",
          },
          {
            name: localizer("en-US", "commands.memory.history.import.prompt_choice_roleplay"),
            value: "roleplay",
          },
          {
            name: localizer("en-US", "commands.memory.history.import.prompt_choice_in_character"),
            value: "in_character",
          },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription(localizer("en-US", "commands.memory.history.import.limit_description"))
        .setRequired(false)
        .setMinValue(50)
        .setMaxValue(100),
    )
    .addBooleanOption((option) =>
      option
        .setName("debug")
        .setDescription(localizer("en-US", "commands.memory.history.import.debug_description"))
        .setRequired(false),
    );

const EXTRACTION_PROMPT_MODAL_ID = "memory_history_import_prompt_modal";
const EXTRACTION_PROMPT_FIELD_ID = "system_prompt";

/**
 * Shows a modal pre-filled with the chosen system prompt template, lets the user edit it,
 * and returns the submit interaction and final system prompt string. For in_character
 * mode the framing template is shown with {persona_nickname} already substituted; the
 * runtime context blocks (attributes, memories, retrieved chunks) are NOT shown in the
 * modal and are appended later by composeInCharacterSystemPrompt.
 */
async function promptForExtractionSystem(
  host: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  mode: ExtractionPromptMode,
  personaForInCharacter?: TomoriState | null,
): Promise<{ submitInteraction: ModalSubmitInteraction; systemPrompt: string } | null> {
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
    {
      modalCustomId: EXTRACTION_PROMPT_MODAL_ID,
      modalTitleKey: "commands.memory.history.import.prompt_modal_title",
      components: [
        {
          customId: EXTRACTION_PROMPT_FIELD_ID,
          style: TextInputStyle.Paragraph,
          labelKey: "commands.memory.history.import.prompt_modal_label",
          placeholder: "commands.memory.history.import.prompt_modal_placeholder",
          required: false,
          maxLength: 4000,
          value: defaultPrompt,
        },
      ],
    },
  );

  if (modalResult.outcome !== "submit" || !modalResult.interaction) return null;
  const systemPrompt = modalResult.values?.[EXTRACTION_PROMPT_FIELD_ID]?.trim() || defaultPrompt;
  return { submitInteraction: modalResult.interaction, systemPrompt };
}

/**
 * Splits an array of formatted message lines into windows of the configured size.
 */
function splitIntoWindows(lines: string[], windowSize: number): string[] {
  const windows: string[] = [];
  for (let i = 0; i < lines.length; i += windowSize) {
    windows.push(lines.slice(i, i + windowSize).join("\n"));
  }
  return windows;
}

/**
 * Runs the LLM extraction for a single text window.
 */
async function extractWindow(
  windowText: string,
  previousRestatements: string[],
  provider: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  endpointUrl?: string,
): Promise<HistoryMemoryEntry[]> {
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
  });
}

/**
 * Fetches messages after a starting anchor and formats them for extraction.
 * Returns null only when the raw fetch yields zero messages (channel-end reached);
 * otherwise returns the formatted result alongside batch boundary metadata so the
 * caller can build the pagination footer and handle empty-after-filtering cases.
 */
async function fetchAndFormatMessages(params: {
  channel: TextBasedChannel;
  startMessageId: string;
  limit: number;
  allPersonas: TomoriState[];
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
  locale: string;
}): Promise<{
  formattedResult: ReturnType<typeof formatMessagesForExtraction>;
  firstMessage: Message;
  lastMessage: Message;
  reachedEnd: boolean;
} | null> {
  const { channel, startMessageId, limit, allPersonas, replyInteraction, locale } = params;

  await replyInteraction.editReply({
    embeds: [
      new EmbedBuilder()
        .setDescription(localizer(locale, "commands.memory.history.import.progress_fetching"))
        .setColor(ColorCode.INFO),
    ],
  });

  const fetchResult = await fetchHistoryAfter(channel, startMessageId, limit);
  if (fetchResult.messages.length === 0) {
    await replyInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.memory.history.import.no_messages_title"))
          .setDescription(localizer(locale, "commands.memory.history.import.no_messages_description"))
          .setColor(ColorCode.WARN),
      ],
    });
    return null;
  }

  const formattedResult = formatMessagesForExtraction(fetchResult.messages, allPersonas);

  return {
    formattedResult,
    firstMessage: fetchResult.messages[0],
    lastMessage: fetchResult.messages[fetchResult.messages.length - 1],
    reachedEnd: fetchResult.reachedEnd,
  };
}

/**
 * Checks document count limit and duplicate name, then creates the document record.
 * Returns the new document_id or null (error already replied).
 */
async function createDocumentForImport(params: {
  documentName: string;
  serverId: number;
  personaId: number | null;
  uploaderUserId: number | null;
  channelTags: string[];
  scopeLabel: string;
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
  locale: string;
}): Promise<number | null> {
  const { documentName, serverId, personaId, uploaderUserId, channelTags, scopeLabel, replyInteraction, locale } =
    params;

  const memoryLimits = getMemoryLimits();

  if (await serverMemoryRepository.documentExistsByName(serverId, personaId, documentName)) {
    await replyInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.memory.history.import.duplicate_title"))
          .setDescription(
            localizer(locale, "commands.memory.history.import.duplicate_description", { name: documentName }),
          )
          .setColor(ColorCode.ERROR),
      ],
    });
    return null;
  }

  const docCount = await serverMemoryRepository.countDocumentsScoped(serverId, personaId);
  if (docCount >= memoryLimits.maxDocumentsPerServer) {
    await replyInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.memory.history.import.limit_exceeded_title"))
          .setDescription(
            localizer(locale, "commands.memory.history.import.limit_exceeded_description", {
              current_count: docCount.toString(),
              max_allowed: memoryLimits.maxDocumentsPerServer.toString(),
              scope: scopeLabel,
            }),
          )
          .setColor(ColorCode.ERROR),
      ],
    });
    return null;
  }

  return await createDocumentRecord({
    serverId,
    personaId,
    uploaderUserId,
    documentName,
    sourceType: "history",
    channelTags,
  });
}

/**
 * Runs incremental LLM extraction over message windows, embedding and persisting each
 * window's facts immediately after extraction to avoid interaction token timeouts.
 *
 * @returns Total fact count and joined chunk text for document finalization, or null
 *          if no facts were extracted (error already replied, caller should clean up documents).
 */
async function runIncrementalExtraction(params: {
  formattedResult: ReturnType<typeof formatMessagesForExtraction>;
  provider: string;
  model: string;
  apiKey: string;
  endpointUrl?: string;
  /** Composes the system prompt for a given window. For static prompts (conversation/roleplay) this returns a constant; for in_character it does per-window RAG. */
  composeSystemPrompt: (windowText: string, windowIndex: number) => Promise<string>;
  /** Optional per-window debug hook — fired after extraction so callers can capture exact prompts sent. */
  onWindowSnapshot?: (snapshot: WindowDebugSnapshot) => void;
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
  locale: string;
  writeTargets: WriteTarget[];
  embeddingModelId: number;
  embeddingFamily: string;
  embeddingProvider: string;
  embeddingCodename: string;
  embeddingApiKey: string;
}): Promise<{ totalFactCount: number; allChunkText: string } | null> {
  const {
    formattedResult,
    provider,
    model,
    apiKey,
    endpointUrl,
    composeSystemPrompt,
    onWindowSnapshot,
    replyInteraction,
    locale,
    writeTargets,
    embeddingModelId,
    embeddingFamily,
    embeddingProvider,
    embeddingCodename,
    embeddingApiKey,
  } = params;

  const messageLines = formattedResult.text.split("\n");
  const windows = splitIntoWindows(messageLines, HISTORY_EXTRACTION_WINDOW_SIZE);
  const allChunks: string[] = [];
  let previousRestatements: string[] = [];
  const chunkStartIndex = new Map<number, number>();
  for (const t of writeTargets) chunkStartIndex.set(t.documentId, 0);

  for (let i = 0; i < windows.length; i++) {
    await replyInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setDescription(
            localizer(locale, "commands.memory.history.import.progress_extracting", {
              message_count: formattedResult.messageCount.toString(),
              current: (i + 1).toString(),
              total: windows.length.toString(),
            }),
          )
          .setColor(ColorCode.INFO),
      ],
    });

    const composedSystemPrompt = await composeSystemPrompt(windows[i], i);
    const windowEntries = await extractWindow(
      windows[i],
      previousRestatements,
      provider,
      model,
      apiKey,
      composedSystemPrompt,
      endpointUrl,
    );

    // Reconstruct the exact user prompt for debug snapshot — same builder extractWindow uses.
    if (onWindowSnapshot) {
      onWindowSnapshot({
        windowIndex: i,
        windowMessageText: windows[i],
        systemPrompt: composedSystemPrompt,
        userPrompt: buildExtractionUserPrompt(windows[i], previousRestatements),
        extractedEntries: windowEntries,
      });
    }

    if (windowEntries.length > 0) {
      const windowChunks = windowEntries.map((e) => e.lossless_restatement);
      allChunks.push(...windowChunks);

      const embeddings = await generateEmbeddingsBatched({
        provider: embeddingProvider,
        apiKey: embeddingApiKey,
        model: embeddingCodename,
        modelId: embeddingModelId,
        inputs: windowChunks,
        taskType: (await providerSupportsEmbeddingTaskType(embeddingProvider)) ? "RETRIEVAL_DOCUMENT" : undefined,
        batchSize: 16,
      });

      for (const target of writeTargets) {
        const startIdx = chunkStartIndex.get(target.documentId) ?? 0;
        await appendDocumentChunks({
          documentId: target.documentId,
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
    return null;
  }

  return { totalFactCount: allChunks.length, allChunkText: allChunks.join("\n\n") };
}

/**
 * Executes the /memory history import command.
 * Extracts atomic facts from channel history using an LLM and stores them for RAG retrieval.
 */
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

  let tomoriState: TomoriState | null = null;
  let personaSelectionInteraction: ButtonInteraction | null = null;
  let modalSubmitInteraction: ModalSubmitInteraction | undefined;

  try {
    if (!isRagAvailable()) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.memory.history.import.rag_disabled_title",
        descriptionKey: "commands.memory.history.import.rag_disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const memCheck = memoryGuard.checkMemory();
    if (memCheck.status === "critical") {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "rate_limit.error_memory_critical_title"))
            .setDescription(localizer(locale, "rate_limit.error_memory_critical_description"))
            .setColor(ColorCode.ERROR),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const quotaReserve = reserveDocumentQuota(interaction.user.id);
    if (!quotaReserve.allowed) {
      const resetTime = quotaReserve.resetAt ? new Date(quotaReserve.resetAt).toLocaleString(locale) : "unknown";
      await replyInfoEmbed(interaction, locale, {
        titleKey: "rate_limit.error_quota_exceeded_title",
        descriptionKey: "rate_limit.error_quota_exceeded_description",
        descriptionVars: { reset_time: resetTime },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
    if (!hasManagePermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.memory.history.import.no_permission_title",
        descriptionKey: "commands.memory.history.import.no_permission_description",
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

    if (!tomoriState.llm.supports_structoutput) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.memory.history.import.model_incompatible_title",
        descriptionKey: "commands.memory.history.import.model_incompatible_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!providerSupportsFeature(tomoriState.llm.llm_provider, "historyExtraction")) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.provider_not_supported_title",
        descriptionKey: "general.errors.provider_not_supported_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let textCreds: ResolvedCredentials;
    let embeddingCreds: ResolvedCredentials;
    try {
      [textCreds, embeddingCreds] = await Promise.all([
        resolveCapabilityCredentials(tomoriState.server_id, "text", {
          userId: userData.user_id ?? null,
        }),
        resolveCapabilityCredentials(tomoriState.server_id, "embedding", {
          userId: userData.user_id ?? null,
        }),
      ]);
    } catch (error) {
      if (error instanceof PersonalProviderRequiredError) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.personal_provider_required_title",
          descriptionKey: "general.errors.personal_provider_required_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (error instanceof CredentialUnavailableError && error.source === "personal") {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.api_key_error_title",
          descriptionKey: "general.errors.personal_provider_credentials_error_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      throw error;
    }

    const embeddingModelId =
      getResolvedCapabilityModelId(embeddingCreds, "embedding") ?? tomoriState.config.embedding_model_id;
    if (!embeddingModelId) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.memory.history.import.no_embedding_model_title",
        descriptionKey: "commands.memory.history.import.no_embedding_model_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embeddingModel = await llmModelRepo.loadEmbeddingModelById(embeddingModelId);
    if (!embeddingModel) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.memory.history.import.no_embedding_model_title",
        descriptionKey: "commands.memory.history.import.no_embedding_model_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nameInput = interaction.options.getString("name", true).trim();
    const scopeInput = interaction.options.getString("scope");
    const scope: HistoryScope =
      scopeInput === "automatic" ? "automatic" : scopeInput === "global" ? "global" : "persona";
    const startMessageId = interaction.options.getString("start_message_id", true).trim();
    const channelsInput = interaction.options.getString("channels");
    const promptModeInput = interaction.options.getString("prompt");
    const promptMode: ExtractionPromptMode =
      promptModeInput === "roleplay"
        ? "roleplay"
        : promptModeInput === "in_character"
          ? "in_character"
          : "conversation";
    const messageFetchLimit = interaction.options.getInteger("limit") ?? 100;
    const debugEnabled = interaction.options.getBoolean("debug") ?? false;

    // In-character extraction requires a single persona's identity to do its job —
    // reject global/automatic combinations rather than silently degrading.
    if (promptMode === "in_character" && scope !== "persona") {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.memory.history.import.in_character_scope_invalid_title",
        descriptionKey: "commands.memory.history.import.in_character_scope_invalid_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Validate the start message ID exists in this channel before doing any further setup,
    // so users with a typo get immediate feedback instead of sitting through the persona/modal flow.
    try {
      await interaction.channel.messages.fetch(startMessageId);
    } catch {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.memory.history.import.invalid_start_id_title",
        descriptionKey: "commands.memory.history.import.invalid_start_id_description",
        descriptionVars: { start_message_id: startMessageId },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const channelTags: string[] = channelsInput
      ? channelsInput
          .split(",")
          .map((raw) => {
            const s = raw.trim();
            const mention = s.match(/^<#(\d+)>$/);
            if (mention) {
              const resolved = _client.channels.cache.get(mention[1]);
              return "name" in (resolved ?? {}) ? (resolved as { name: string }).name.toLowerCase() : "";
            }
            return s.toLowerCase().replace(/^#+/, "");
          })
          .filter((c) => c.length > 0 && /^[\w-]+$/.test(c))
          .map((c) => `#${c}`)
      : [];

    const provider = tomoriState.llm.llm_provider.toLowerCase();
    const model = getEffectiveLlmModelName(tomoriState.llm, tomoriState.config.custom_model_name);
    const endpointUrl = tomoriState.config.custom_endpoint_url ?? undefined;

    const allPersonas = await personaRepository.loadAllForServer(guildId);

    // Shared embedding params passed to runIncrementalExtraction
    const embeddingParams = {
      embeddingModelId,
      embeddingFamily: embeddingModel.model_family,
      embeddingProvider: embeddingModel.provider as string,
      embeddingCodename: embeddingModel.codename,
      embeddingApiKey: embeddingCreds.apiKey,
    };

    // ====================================================================
    // SCOPE: PERSONA
    // ====================================================================
    if (scope === "persona") {
      if (allPersonas.length === 0) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.tomori_not_setup_title",
          descriptionKey: "general.errors.tomori_not_setup_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success || personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
        return;
      }

      personaSelectionInteraction = personaSelection.interaction;
      const selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
      if (!selectedPersona?.persona_id) {
        await replyInfoEmbed(personaSelectionInteraction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      const targetPersonaId = selectedPersona.persona_id;
      const scopeLabel = localizer(locale, "commands.memory.history.import.scope_label_persona", {
        persona_name: selectedPersona.persona_nickname,
      });

      const promptModalResult = await promptForExtractionSystem(
        personaSelectionInteraction,
        locale,
        promptMode,
        selectedPersona,
      );
      if (!promptModalResult) return;
      modalSubmitInteraction = promptModalResult.submitInteraction;
      const personaSystemPrompt = promptModalResult.systemPrompt;

      await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      const fetchResult = await fetchAndFormatMessages({
        channel: interaction.channel,
        startMessageId,
        limit: messageFetchLimit,
        allPersonas,
        replyInteraction: modalSubmitInteraction,
        locale,
      });
      if (!fetchResult) return;

      // For in-character mode, precompute the channel-filtered existing memories once.
      // The retrieval-and-compose closure handles per-window RAG below.
      const inCharacterFilterTags =
        channelTags.length > 0
          ? channelTags.map((t) => t.replace(/^#/, ""))
          : interaction.channel && "name" in interaction.channel && interaction.channel.name
            ? [interaction.channel.name.toLowerCase()]
            : [];

      // Capture into a const so TypeScript can narrow inside the async closure below.
      const personaServerId = tomoriState.server_id;

      const inCharacterExistingMemories =
        promptMode === "in_character"
          ? await loadInCharacterMemoryLines(
              personaServerId,
              selectedPersona.persona_lineage_id ?? null,
              inCharacterFilterTags,
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
                filterChannelTags: inCharacterFilterTags,
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

      // Debug capture — only meaningful for in_character mode (per-window prompts vary).
      const debugSnapshots: WindowDebugSnapshot[] = [];
      const debugActive = debugEnabled && promptMode === "in_character";
      const onWindowSnapshot = debugActive ? (snap: WindowDebugSnapshot) => debugSnapshots.push(snap) : undefined;

      const footer = buildFooter({
        firstMessage: fetchResult.firstMessage,
        lastMessage: fetchResult.lastMessage,
        reachedEnd: fetchResult.reachedEnd,
        guildId: interaction.guild?.id ?? null,
        channelId: interaction.channel.id,
        locale,
      });

      if (fetchResult.formattedResult.messageCount === 0) {
        await modalSubmitInteraction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.memory.history.import.no_extractable_content_title"))
              .setDescription(
                `${localizer(locale, "commands.memory.history.import.no_extractable_content_description")}\n\n${footer}`,
              )
              .setColor(ColorCode.WARN),
          ],
        });
        return;
      }

      const documentId = await createDocumentForImport({
        documentName: nameInput,
        serverId: tomoriState.server_id,
        personaId: targetPersonaId,
        uploaderUserId: userData.user_id ?? null,
        channelTags,
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
        endpointUrl,
        composeSystemPrompt,
        onWindowSnapshot,
        replyInteraction: modalSubmitInteraction,
        locale,
        writeTargets: [{ documentId, dbServerId: tomoriState.server_id, personaId: targetPersonaId }],
        ...embeddingParams,
      });

      // Ship debug dump regardless of extraction outcome — snapshots are useful even
      // when zero facts come back (in fact, *especially* then).
      if (debugActive && debugSnapshots.length > 0) {
        await sendInCharacterDebugDump({
          interaction,
          locale,
          personaNickname: selectedPersona.persona_nickname,
          provider,
          model,
          snapshots: debugSnapshots,
        });
      }

      if (!extractResult) {
        await serverMemoryRepository.removeDocument(documentId, tomoriState.server_id, targetPersonaId);
        await showNoFactsExtractedEmbed(modalSubmitInteraction, locale, footer);
        return;
      }

      await finalizeDocumentContent(documentId, extractResult.allChunkText);
      invalidateTomoriStateCache(guildId);

      await modalSubmitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.memory.history.import.success_title"))
            .setDescription(
              `${localizer(locale, "commands.memory.history.import.success_description", {
                fact_count: extractResult.totalFactCount.toString(),
                message_count: fetchResult.formattedResult.messageCount.toString(),
                name: nameInput,
                chunk_count: extractResult.totalFactCount.toString(),
                scope: scopeLabel,
              })}\n\n${footer}`,
            )
            .setColor(ColorCode.SUCCESS),
        ],
      });
      return;
    }

    // ====================================================================
    // SCOPE: GLOBAL
    // ====================================================================
    if (scope === "global") {
      const scopeLabel = localizer(locale, "commands.memory.history.import.scope_label_global");

      const promptModalResult = await promptForExtractionSystem(interaction, locale, promptMode);
      if (!promptModalResult) return;
      modalSubmitInteraction = promptModalResult.submitInteraction;
      const globalSystemPrompt = promptModalResult.systemPrompt;

      await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      const fetchResult = await fetchAndFormatMessages({
        channel: interaction.channel,
        startMessageId,
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
        await modalSubmitInteraction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.memory.history.import.no_extractable_content_title"))
              .setDescription(
                `${localizer(locale, "commands.memory.history.import.no_extractable_content_description")}\n\n${footer}`,
              )
              .setColor(ColorCode.WARN),
          ],
        });
        return;
      }

      const documentId = await createDocumentForImport({
        documentName: nameInput,
        serverId: tomoriState.server_id,
        personaId: null,
        uploaderUserId: userData.user_id ?? null,
        channelTags,
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
        endpointUrl,
        composeSystemPrompt: async () => globalSystemPrompt,
        replyInteraction: modalSubmitInteraction,
        locale,
        writeTargets: [{ documentId, dbServerId: tomoriState.server_id, personaId: null }],
        ...embeddingParams,
      });

      if (!extractResult) {
        await serverMemoryRepository.removeDocument(documentId, tomoriState.server_id, null);
        await showNoFactsExtractedEmbed(modalSubmitInteraction, locale, footer);
        return;
      }

      await finalizeDocumentContent(documentId, extractResult.allChunkText);
      invalidateTomoriStateCache(guildId);

      await modalSubmitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.memory.history.import.success_title"))
            .setDescription(
              `${localizer(locale, "commands.memory.history.import.success_description", {
                fact_count: extractResult.totalFactCount.toString(),
                message_count: fetchResult.formattedResult.messageCount.toString(),
                name: nameInput,
                chunk_count: extractResult.totalFactCount.toString(),
                scope: scopeLabel,
              })}\n\n${footer}`,
            )
            .setColor(ColorCode.SUCCESS),
        ],
      });
      return;
    }

    // ====================================================================
    // SCOPE: AUTOMATIC
    // Detect personas from webhook authors, create per-persona documents
    // before extraction starts so chunks are written incrementally.
    // ====================================================================
    const autoPromptModalResult = await promptForExtractionSystem(interaction, locale, promptMode);
    if (!autoPromptModalResult) return;
    modalSubmitInteraction = autoPromptModalResult.submitInteraction;
    const autoSystemPrompt = autoPromptModalResult.systemPrompt;

    await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    const fetchResult = await fetchAndFormatMessages({
      channel: interaction.channel,
      startMessageId,
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
      await modalSubmitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.memory.history.import.no_extractable_content_title"))
            .setDescription(
              `${localizer(locale, "commands.memory.history.import.no_extractable_content_description")}\n\n${footer}`,
            )
            .setColor(ColorCode.WARN),
        ],
      });
      return;
    }

    if (detectedTomoriIds.length === 0) {
      // No personas detected — fall back to global scope
      const scopeLabel = localizer(locale, "commands.memory.history.import.scope_label_global");

      const documentId = await createDocumentForImport({
        documentName: nameInput,
        serverId: tomoriState.server_id,
        personaId: null,
        uploaderUserId: userData.user_id ?? null,
        channelTags,
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
        endpointUrl,
        composeSystemPrompt: async () => autoSystemPrompt,
        replyInteraction: modalSubmitInteraction,
        locale,
        writeTargets: [{ documentId, dbServerId: tomoriState.server_id, personaId: null }],
        ...embeddingParams,
      });

      if (!extractResult) {
        await serverMemoryRepository.removeDocument(documentId, tomoriState.server_id, null);
        await showNoFactsExtractedEmbed(modalSubmitInteraction, locale, footer);
        return;
      }

      await finalizeDocumentContent(documentId, extractResult.allChunkText);
      invalidateTomoriStateCache(guildId);

      await modalSubmitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.memory.history.import.success_title"))
            .setDescription(
              `${localizer(locale, "commands.memory.history.import.success_automatic_global_fallback", {
                name: nameInput,
              })}\n\n${footer}`,
            )
            .setColor(ColorCode.SUCCESS),
        ],
      });
      return;
    }

    // Create per-persona document records before extraction starts
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

      const documentId = await createDocumentRecord({
        serverId: tomoriState.server_id,
        personaId,
        uploaderUserId: userData.user_id ?? null,
        documentName: docName,
        sourceType: "history",
        channelTags,
      });

      personaTargets.push({
        target: { documentId, dbServerId: tomoriState.server_id, personaId },
        personaNickname: persona.persona_nickname,
        docName,
      });
    }

    if (personaTargets.length === 0) {
      await modalSubmitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.memory.history.import.duplicate_title"))
            .setDescription(
              localizer(locale, "commands.memory.history.import.duplicate_description", { name: nameInput }),
            )
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    // Run extraction once, writing each window's chunks to all persona documents
    const extractResult = await runIncrementalExtraction({
      formattedResult,
      provider,
      model,
      apiKey: textCreds.apiKey,
      endpointUrl,
      composeSystemPrompt: async () => autoSystemPrompt,
      replyInteraction: modalSubmitInteraction,
      locale,
      writeTargets: personaTargets.map((pt) => pt.target),
      ...embeddingParams,
    });

    for (const { target } of personaTargets) {
      if (!extractResult) {
        await serverMemoryRepository.removeDocument(target.documentId, tomoriState.server_id, target.personaId);
      } else {
        await finalizeDocumentContent(target.documentId, extractResult.allChunkText);
      }
    }

    if (!extractResult) {
      await showNoFactsExtractedEmbed(modalSubmitInteraction, locale, footer);
      return;
    }

    invalidateTomoriStateCache(guildId);

    const personaResultLines = personaTargets.map(({ personaNickname, docName }) =>
      localizer(locale, "commands.memory.history.import.success_automatic_persona_line", {
        persona_name: personaNickname,
        doc_name: docName,
        chunk_count: extractResult.totalFactCount.toString(),
      }),
    );

    await modalSubmitInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.memory.history.import.success_title"))
          .setDescription(
            `${localizer(locale, "commands.memory.history.import.success_automatic_description", {
              fact_count: extractResult.totalFactCount.toString(),
              message_count: formattedResult.messageCount.toString(),
              persona_list: personaResultLines.join("\n"),
            })}\n\n${footer}`,
          )
          .setColor(ColorCode.SUCCESS),
      ],
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: tomoriState?.persona_id,
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
        : personaSelectionInteraction && (personaSelectionInteraction.deferred || personaSelectionInteraction.replied)
          ? personaSelectionInteraction
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
