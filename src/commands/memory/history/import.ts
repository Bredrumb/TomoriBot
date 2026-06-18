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
  SlashCommandSubcommandBuilder,
  TextBasedChannel,
} from "discord.js";
import { MessageFlags, EmbedBuilder, TextInputStyle } from "discord.js";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { llmModelRepo, personaRepository, ragRepository, serverMemoryRepository } from "@/utils/db/repositories";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { memoryGuard, reserveDocumentQuota } from "@/utils/security/rateLimiter";
import { generateEmbeddingsBatched, providerSupportsEmbeddingTaskType } from "@/utils/embeddings/embeddingProvider";
import { fetchHistoryUntilMarker } from "@/utils/discord/historyFetcher";
import { formatMessagesForExtraction } from "@/utils/discord/historyFormatter";
import {
  buildExtractionUserPrompt,
  EXTRACTION_CONVERSATION_SYSTEM_PROMPT,
  EXTRACTION_ROLEPLAY_SYSTEM_PROMPT,
  type ExtractionPromptMode,
} from "@/utils/documents/historyExtractionPrompt";
import type { HistoryMemoryEntry } from "@/providers/utils/historyExtractionSchema";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
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

type HistoryScope = "persona" | "automatic" | "global";

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
        ),
    );

const EXTRACTION_PROMPT_MODAL_ID = "memory_history_import_prompt_modal";
const EXTRACTION_PROMPT_FIELD_ID = "system_prompt";

/**
 * Shows a modal pre-filled with the chosen system prompt template, lets the user edit it,
 * and returns the submit interaction and final system prompt string.
 */
async function promptForExtractionSystem(
  host: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  mode: ExtractionPromptMode,
): Promise<{ submitInteraction: ModalSubmitInteraction; systemPrompt: string } | null> {
  const defaultPrompt = mode === "roleplay" ? EXTRACTION_ROLEPLAY_SYSTEM_PROMPT : EXTRACTION_CONVERSATION_SYSTEM_PROMPT;

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
    MessageFlags.Ephemeral,
  );

  if (modalResult.outcome !== "submit" || !modalResult.interaction) return null;
  const systemPrompt = modalResult.values?.[EXTRACTION_PROMPT_FIELD_ID]?.trim() || defaultPrompt;
  return { submitInteraction: modalResult.interaction, systemPrompt };
}

/**
 * Splits an array of formatted message lines into windows of the configured size.
 *
 * @param lines - Array of formatted message lines
 * @param windowSize - Maximum lines per window
 * @returns Array of joined-text windows
 */
function splitIntoWindows(lines: string[], windowSize: number): string[] {
  const windows: string[] = [];
  for (let i = 0; i < lines.length; i += windowSize) {
    const windowLines = lines.slice(i, i + windowSize);
    windows.push(windowLines.join("\n"));
  }
  return windows;
}

/**
 * Runs the LLM extraction for a single text window using the server's configured provider.
 *
 * @param windowText - Formatted message text for this window
 * @param previousRestatements - Dedup context from previous window
 * @param provider - LLM provider name (google, openrouter)
 * @param model - LLM model codename
 * @param apiKey - Decrypted API key
 * @returns Array of extracted memory entries, or empty array on failure
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
 * Shared processing pipeline for all scopes.
 * Fetches messages, extracts facts, generates embeddings, and stores documents.
 *
 * @returns Object with extracted data or null on failure (error already replied)
 */
async function runExtractionPipeline(params: {
  channel: TextBasedChannel;
  messageFetchLimit: number;
  provider: string;
  model: string;
  apiKey: string;
  endpointUrl?: string;
  systemPrompt: string;
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
  locale: string;
  serverId: string;
  allPersonas: TomoriState[];
}): Promise<{
  entries: HistoryMemoryEntry[];
  formattedResult: ReturnType<typeof formatMessagesForExtraction>;
} | null> {
  const { channel, provider, model, apiKey, endpointUrl, systemPrompt, replyInteraction, locale } = params;

  // 1. Update progress: fetching messages
  await replyInteraction.editReply({
    embeds: [
      new EmbedBuilder()
        .setDescription(localizer(locale, "commands.memory.history.import.progress_fetching"))
        .setColor(ColorCode.INFO),
    ],
  });

  // 2. Fetch messages
  const fetchResult = await fetchHistoryUntilMarker(channel, params.messageFetchLimit);
  if (fetchResult.messages.length === 0) {
    await replyInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.memory.history.import.no_messages_title"))
          .setDescription(localizer(locale, "commands.memory.history.import.no_messages_description"))
          .setColor(ColorCode.ERROR),
      ],
    });
    return null;
  }

  // 3. Format messages for extraction
  const formattedResult = formatMessagesForExtraction(fetchResult.messages, params.allPersonas);
  if (formattedResult.messageCount === 0) {
    await replyInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.memory.history.import.no_messages_title"))
          .setDescription(localizer(locale, "commands.memory.history.import.no_messages_description"))
          .setColor(ColorCode.ERROR),
      ],
    });
    return null;
  }

  // 4. Split into extraction windows
  const messageLines = formattedResult.text.split("\n");
  const windows = splitIntoWindows(messageLines, HISTORY_EXTRACTION_WINDOW_SIZE);

  // 5. Extract facts from each window
  const allEntries: HistoryMemoryEntry[] = [];
  let previousRestatements: string[] = [];

  for (let i = 0; i < windows.length; i++) {
    // Update progress
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

    const windowEntries = await extractWindow(windows[i], previousRestatements, provider, model, apiKey, systemPrompt, endpointUrl);

    allEntries.push(...windowEntries);

    // Update dedup context for next window
    if (windowEntries.length > 0) {
      previousRestatements = windowEntries.slice(-DEDUP_CONTEXT_COUNT).map((e) => e.lossless_restatement);
    }
  }

  // 6. Check if any facts were extracted
  if (allEntries.length === 0) {
    await replyInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.memory.history.import.no_facts_extracted_title"))
          .setDescription(localizer(locale, "commands.memory.history.import.no_facts_extracted_description"))
          .setColor(ColorCode.ERROR),
      ],
    });
    return null;
  }

  return { entries: allEntries, formattedResult };
}

/**
 * Stores extracted facts as a document with embedded chunks.
 *
 * @returns Object with documentId and chunkCount, or null on limit errors (already replied)
 */
async function storeExtractedFacts(params: {
  entries: HistoryMemoryEntry[];
  documentName: string;
  serverId: number;
  personaId: number | null;
  uploaderUserId: number | null;
  embeddingModelId: number;
  embeddingFamily: string;
  embeddingProvider: string;
  embeddingCodename: string;
  apiKey: string;
  scopeLabel: string;
  channelTags: string[];
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
  locale: string;
  guildId: string;
}): Promise<{ documentId: number; chunkCount: number } | null> {
  const {
    entries,
    documentName,
    serverId,
    personaId,
    uploaderUserId,
    embeddingModelId,
    embeddingFamily,
    embeddingProvider,
    embeddingCodename,
    apiKey,
    scopeLabel,
    channelTags,
    replyInteraction,
    locale,
    guildId,
  } = params;

  const memoryLimits = getMemoryLimits();

  // 1. Build chunks from lossless_restatement fields
  const chunks = entries.map((e) => e.lossless_restatement);
  const textContent = chunks.join("\n\n");

  // 2. Check document count limit
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

  // 3. Check chunk count limit
  const currentChunkCount = await serverMemoryRepository.countChunksScoped(serverId, personaId);
  if (currentChunkCount + chunks.length > memoryLimits.maxDocumentChunksPerServer) {
    await replyInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.memory.history.import.server_chunk_limit_title"))
          .setDescription(
            localizer(locale, "commands.memory.history.import.server_chunk_limit_description", {
              max_chunks: memoryLimits.maxDocumentChunksPerServer.toString(),
              scope: scopeLabel,
            }),
          )
          .setColor(ColorCode.ERROR),
      ],
    });
    return null;
  }

  // 4. Update progress: embedding
  await replyInteraction.editReply({
    embeds: [
      new EmbedBuilder()
        .setDescription(
          localizer(locale, "commands.memory.history.import.progress_embedding", {
            fact_count: chunks.length.toString(),
          }),
        )
        .setColor(ColorCode.INFO),
    ],
  });

  // 5. Generate embeddings
  const embeddings = await generateEmbeddingsBatched({
    provider: embeddingProvider,
    apiKey,
    model: embeddingCodename,
    modelId: embeddingModelId,
    inputs: chunks,
    taskType: (await providerSupportsEmbeddingTaskType(embeddingProvider)) ? "RETRIEVAL_DOCUMENT" : undefined,
    batchSize: 16,
  });

  // 6. Insert document with chunks
  const documentId = await ragRepository.insertWithChunks({
    serverId,
    personaId,
    uploaderUserId,
    documentName,
    fileName: null,
    mimeType: null,
    fileSizeBytes: null,
    textContent,
    chunks,
    embeddings,
    embeddingModelId,
    embeddingFamily,
    sourceType: "history",
    channelTags,
  });

  // 7. Invalidate cache
  invalidateTomoriStateCache(guildId);

  return { documentId, chunkCount: chunks.length };
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
  // 1. Ensure command is run in a valid channel context
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
    // 2. Check RAG is enabled
    if (!isRagAvailable()) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.memory.history.import.rag_disabled_title",
        descriptionKey: "commands.memory.history.import.rag_disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 3. Check memory guard
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

    // 4. Reserve document quota
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

    // 5. Check ManageGuild permission
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

    // 6. Load server's Tomori state
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

    // 7. Check model supports structured output
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

    // 8. Validate embedding model
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

    // 9. Get command options
    const nameInput = interaction.options.getString("name", true).trim();
    const scopeInput = interaction.options.getString("scope");
    const scope: HistoryScope =
      scopeInput === "automatic" ? "automatic" : scopeInput === "global" ? "global" : "persona";
    const channelsInput = interaction.options.getString("channels");
    const promptModeInput = interaction.options.getString("prompt");
    const promptMode: ExtractionPromptMode = promptModeInput === "roleplay" ? "roleplay" : "conversation";
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

    // 10. Decrypt API key
    const provider = tomoriState.llm.llm_provider.toLowerCase();
    const model = getEffectiveLlmModelName(tomoriState.llm, tomoriState.config.custom_model_name);
    const endpointUrl = tomoriState.config.custom_endpoint_url ?? undefined;
    const messageFetchLimit = normalizeMessageFetchLimit(tomoriState.config.message_fetch_limit);

    // Load all personas for formatting and detection
    const allPersonas = await personaRepository.loadAllForServer(guildId);

    // ====================================================================
    // SCOPE: PERSONA — Pattern 4 → Pattern 2 hybrid (persona selector first)
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

      // Show persona selector (acknowledges interaction)
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

      // Show system prompt modal on the button interaction
      const promptModalResult = await promptForExtractionSystem(personaSelectionInteraction, locale, promptMode);
      if (!promptModalResult) return;
      modalSubmitInteraction = promptModalResult.submitInteraction;
      const personaSystemPrompt = promptModalResult.systemPrompt;

      // Defer the modal submit interaction for long processing
      await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      // Check duplicate name
      if (await serverMemoryRepository.documentExistsByName(tomoriState.server_id, targetPersonaId, nameInput)) {
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

      // Run extraction pipeline
      const pipelineResult = await runExtractionPipeline({
        channel: interaction.channel,
        messageFetchLimit,
        provider,
        model,
        apiKey: textCreds.apiKey,
        endpointUrl,
        systemPrompt: personaSystemPrompt,
        replyInteraction: modalSubmitInteraction,
        locale,
        serverId: guildId,
        allPersonas,
      });
      if (!pipelineResult) return;

      // Store facts
      const storeResult = await storeExtractedFacts({
        entries: pipelineResult.entries,
        documentName: nameInput,
        serverId: tomoriState.server_id,
        personaId: targetPersonaId,
        uploaderUserId: userData.user_id ?? null,
        embeddingModelId,
        embeddingFamily: embeddingModel.model_family,
        embeddingProvider: embeddingModel.provider as string,
        embeddingCodename: embeddingModel.codename,
        apiKey: embeddingCreds.apiKey,
        scopeLabel,
        channelTags,
        replyInteraction: modalSubmitInteraction,
        locale,
        guildId,
      });
      if (!storeResult) return;

      // Success reply
      await modalSubmitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.memory.history.import.success_title"))
            .setDescription(
              localizer(locale, "commands.memory.history.import.success_description", {
                fact_count: pipelineResult.entries.length.toString(),
                message_count: pipelineResult.formattedResult.messageCount.toString(),
                name: nameInput,
                chunk_count: storeResult.chunkCount.toString(),
                scope: scopeLabel,
              }),
            )
            .setColor(ColorCode.SUCCESS),
        ],
      });
      return;
    }

    // ====================================================================
    // SCOPE: GLOBAL — Show prompt modal, then defer modal submit interaction
    // ====================================================================
    if (scope === "global") {
      const scopeLabel = localizer(locale, "commands.memory.history.import.scope_label_global");

      // Show system prompt modal on the slash command interaction
      const promptModalResult = await promptForExtractionSystem(interaction, locale, promptMode);
      if (!promptModalResult) return;
      modalSubmitInteraction = promptModalResult.submitInteraction;
      const globalSystemPrompt = promptModalResult.systemPrompt;

      await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      // Check duplicate name (serverwide scope = persona_id IS NULL)
      if (await serverMemoryRepository.documentExistsByName(tomoriState.server_id, null, nameInput)) {
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

      // Run extraction pipeline
      const pipelineResult = await runExtractionPipeline({
        channel: interaction.channel,
        messageFetchLimit,
        provider,
        model,
        apiKey: textCreds.apiKey,
        endpointUrl,
        systemPrompt: globalSystemPrompt,
        replyInteraction: modalSubmitInteraction,
        locale,
        serverId: guildId,
        allPersonas,
      });
      if (!pipelineResult) return;

      // Store facts
      const storeResult = await storeExtractedFacts({
        entries: pipelineResult.entries,
        documentName: nameInput,
        serverId: tomoriState.server_id,
        personaId: null,
        uploaderUserId: userData.user_id ?? null,
        embeddingModelId,
        embeddingFamily: embeddingModel.model_family,
        embeddingProvider: embeddingModel.provider as string,
        embeddingCodename: embeddingModel.codename,
        apiKey: embeddingCreds.apiKey,
        scopeLabel,
        channelTags,
        replyInteraction: modalSubmitInteraction,
        locale,
        guildId,
      });
      if (!storeResult) return;

      // Success reply
      await modalSubmitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.memory.history.import.success_title"))
            .setDescription(
              localizer(locale, "commands.memory.history.import.success_description", {
                fact_count: pipelineResult.entries.length.toString(),
                message_count: pipelineResult.formattedResult.messageCount.toString(),
                name: nameInput,
                chunk_count: storeResult.chunkCount.toString(),
                scope: scopeLabel,
              }),
            )
            .setColor(ColorCode.SUCCESS),
        ],
      });
      return;
    }

    // ====================================================================
    // SCOPE: AUTOMATIC — Show prompt modal, then defer modal submit interaction
    // Detect personas from webhook authors, create per-persona documents
    // ====================================================================
    const autoPromptModalResult = await promptForExtractionSystem(interaction, locale, promptMode);
    if (!autoPromptModalResult) return;
    modalSubmitInteraction = autoPromptModalResult.submitInteraction;
    const autoSystemPrompt = autoPromptModalResult.systemPrompt;

    await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    // Run extraction pipeline (extracts facts + detects personas)
    const pipelineResult = await runExtractionPipeline({
      channel: interaction.channel,
      messageFetchLimit,
      provider,
      model,
      apiKey: textCreds.apiKey,
      endpointUrl,
      systemPrompt: autoSystemPrompt,
      replyInteraction: modalSubmitInteraction,
      locale,
      serverId: guildId,
      allPersonas,
    });
    if (!pipelineResult) return;

    const { entries, formattedResult } = pipelineResult;
    const detectedTomoriIds = formattedResult.detectedPersonaTomoriIds;

    // If no personas detected, fallback to global
    if (detectedTomoriIds.length === 0) {
      const scopeLabel = localizer(locale, "commands.memory.history.import.scope_label_global");

      // Check duplicate name in global scope
      if (await serverMemoryRepository.documentExistsByName(tomoriState.server_id, null, nameInput)) {
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

      const storeResult = await storeExtractedFacts({
        entries,
        documentName: nameInput,
        serverId: tomoriState.server_id,
        personaId: null,
        uploaderUserId: userData.user_id ?? null,
        embeddingModelId,
        embeddingFamily: embeddingModel.model_family,
        embeddingProvider: embeddingModel.provider as string,
        embeddingCodename: embeddingModel.codename,
        apiKey: embeddingCreds.apiKey,
        scopeLabel,
        channelTags,
        replyInteraction: modalSubmitInteraction,
        locale,
        guildId,
      });
      if (!storeResult) return;

      await modalSubmitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.memory.history.import.success_title"))
            .setDescription(
              localizer(locale, "commands.memory.history.import.success_automatic_global_fallback", {
                name: nameInput,
              }),
            )
            .setColor(ColorCode.SUCCESS),
        ],
      });
      return;
    }

    // Create per-persona documents
    const personaResults: string[] = [];

    for (const personaId of detectedTomoriIds) {
      const persona = allPersonas.find((p) => p.persona_id === personaId);
      if (!persona) continue;

      const docName = `${nameInput} (${persona.persona_nickname})`;
      const scopeLabel = localizer(locale, "commands.memory.history.import.scope_label_persona", {
        persona_name: persona.persona_nickname,
      });

      // Check duplicate name for this persona
      if (await serverMemoryRepository.documentExistsByName(tomoriState.server_id, personaId, docName)) {
        log.warn(`Skipping duplicate document "${docName}" for persona ${personaId} during automatic scope`);
        continue;
      }

      const storeResult = await storeExtractedFacts({
        entries,
        documentName: docName,
        serverId: tomoriState.server_id,
        personaId,
        uploaderUserId: userData.user_id ?? null,
        embeddingModelId,
        embeddingFamily: embeddingModel.model_family,
        embeddingProvider: embeddingModel.provider as string,
        embeddingCodename: embeddingModel.codename,
        apiKey: embeddingCreds.apiKey,
        scopeLabel,
        channelTags,
        replyInteraction: modalSubmitInteraction,
        locale,
        guildId,
      });

      if (storeResult) {
        personaResults.push(
          localizer(locale, "commands.memory.history.import.success_automatic_persona_line", {
            persona_name: persona.persona_nickname,
            doc_name: docName,
            chunk_count: storeResult.chunkCount.toString(),
          }),
        );
      }
    }

    // Final success reply
    await modalSubmitInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.memory.history.import.success_title"))
          .setDescription(
            localizer(locale, "commands.memory.history.import.success_automatic_description", {
              fact_count: entries.length.toString(),
              message_count: formattedResult.messageCount.toString(),
              persona_list: personaResults.join("\n"),
            }),
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
