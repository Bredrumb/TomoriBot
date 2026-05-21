import type { ChatInputCommandInteraction, Client, Message, SlashCommandSubcommandBuilder } from "discord.js";
import { AttachmentBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed, promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/interactionHelper";
import { sliceMessagesAtResetMarker } from "@/utils/discord/embedDetection";
import {
  checkTargetEmbedTitle,
  processLinkEmbed,
  formatSystemProducedEmbedHint,
} from "@/utils/discord/embedClassifier";
import { getCachedTomoriState, getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { getCachedChannelLlm } from "@/utils/cache/channelLlmCache";
import { loadSavedProviderConfig } from "@/utils/db/dbRead";
import { buildContext } from "@/utils/text/contextBuilder";
import { getCachedActivePreset } from "@/utils/cache/stPresetCache";
import { getCachedPrivacyLevel, getCachedUserRow } from "@/utils/cache/userCache";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { PrivacyLevel, type UserRow, type TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { GoogleStreamAdapter } from "@/providers/google/googleStreamAdapter";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { AnthropicStreamAdapter } from "@/providers/anthropic/anthropicStreamAdapter";
import { VertexStreamAdapter } from "@/providers/vertex/vertexStreamAdapter";
import { VertexexpressStreamAdapter } from "@/providers/vertexexpress/vertexexpressStreamAdapter";
import { type ToolStateForContext, getAvailableToolsWithMCP } from "@/tools/toolRegistry";
import { getGoogleToolAdapter } from "@/providers/google/googleToolAdapter";
import { getAnthropicToolAdapter } from "@/providers/anthropic/anthropicToolAdapter";
import { getOpenrouterToolAdapter } from "@/providers/openrouter/openrouterToolAdapter";
import { getCustomToolAdapter } from "@/providers/custom/customToolAdapter";
import { getDeepseekToolAdapter } from "@/providers/deepseek/deepseekToolAdapter";
import { getNvidiaToolAdapter } from "@/providers/nvidia/nvidiaToolAdapter";
import { getZaiToolAdapter } from "@/providers/zai/zaiToolAdapter";
import { getZaicodingToolAdapter } from "@/providers/zaicoding/zaicodingToolAdapter";
import { getVertexToolAdapter } from "@/providers/vertex/vertexToolAdapter";
import { getVertexexpressToolAdapter } from "@/providers/vertexexpress/vertexexpressToolAdapter";
import { getNovelaiToolAdapter } from "@/providers/novelai/novelaiToolAdapter";
import type { MCPCapableToolAdapter } from "@/types/tool/interfaces";
import { buildActiveSamplingParams, selectAnthropicSamplingParams } from "@/utils/provider/samplingControl";
import {
  buildAnthropicThinkingRequest,
  buildCustomThinkingRequest,
  buildDeepSeekThinkingRequest,
  buildGoogleThinkingConfig,
  buildOpenRouterReasoningRequest,
  buildZaiThinkingRequest,
  getNovelAiThinkingDirective,
  serializeGoogleThinkingConfig,
} from "@/utils/provider/thinkingControl";
import { buildProviderStopStrings } from "@/providers/utils/stopStrings";
import { getEmojiPenaltyDirective } from "@/utils/text/emojiPenalty";
import {
  filterDeliberateToolNames,
  getDeliberateToolIntentResult,
  getFollowUpToolIntentResult,
  resolveDeliberateToolMode,
} from "@/utils/tools/deliberateToolMode";

// ─── Constants ────────────────────────────────────────────────────────────────

const PERSONA_SELECT_ID = "prompt_snapshot_persona_select";

// Matches YouTube links in message content — same pattern as /tool estimate cost
const YOUTUBE_URL_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i,
];

const SNAPSHOT_SUPPORTED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/mpeg",
  "video/mov",
  "video/avi",
  "video/x-flv",
  "video/mpg",
  "video/webm",
  "video/wmv",
  "video/3gpp",
];

type SnapshotToolFilter = {
  disabledByDeliberateMode: boolean;
  allowedToolNames: string[];
};

// ─── Tail directive helpers (mirrors cost.ts / tomoriChat.ts) ─────────────────

function normalizeTailDirective(text: string): string {
  let trimmed = text.trim();
  if (!trimmed) return "";
  if (/^\[System:/i.test(trimmed)) {
    trimmed = trimmed.replace(/^\[System:\s*/i, "");
    if (trimmed.endsWith("]")) trimmed = trimmed.slice(0, -1).trim();
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) trimmed = trimmed.slice(1, -1).trim();
  return trimmed;
}

function buildCombinedTailDirectiveMessage(directives: string[]): StructuredContextItem | null {
  const normalized = directives.map(normalizeTailDirective).filter((d) => d.length > 0);
  if (normalized.length === 0) return null;
  return {
    role: "user",
    parts: [{ type: "text", text: `[System: ${normalized.join("\n\n")}]` }],
    metadataTag: ContextItemTag.DIALOGUE_HISTORY,
  };
}

function insertBeforeLatestDialoguePair(
  contextSegments: StructuredContextItem[],
  injectedItem: StructuredContextItem,
): void {
  const dialogueIndexes: number[] = [];
  for (let i = contextSegments.length - 1; i >= 0; i--) {
    const item = contextSegments[i];
    if (item.metadataTag === ContextItemTag.DIALOGUE_HISTORY && (item.role === "user" || item.role === "model")) {
      dialogueIndexes.push(i);
      if (dialogueIndexes.length === 2) break;
    }
  }
  if (dialogueIndexes.length === 0) {
    contextSegments.push(injectedItem);
    return;
  }
  const insertAt = dialogueIndexes.length >= 2 ? dialogueIndexes[1] : dialogueIndexes[0];
  contextSegments.splice(insertAt, 0, injectedItem);
}

function isSnapshotImageAttachment(contentType: string | null | undefined): boolean {
  return (
    contentType?.startsWith("image/png") ||
    contentType?.startsWith("image/jpeg") ||
    contentType?.startsWith("image/webp") ||
    contentType?.startsWith("image/heic") ||
    contentType?.startsWith("image/heif") ||
    contentType?.startsWith("image/gif") ||
    false
  );
}

function isSnapshotAudioAttachment(contentType: string | null | undefined): boolean {
  return Boolean(contentType?.startsWith("audio/"));
}

function isSnapshotVideoAttachment(contentType: string | null | undefined): boolean {
  return Boolean(contentType && SNAPSHOT_SUPPORTED_VIDEO_MIME_TYPES.some((type) => contentType.startsWith(type)));
}

function getSnapshotRecentToolAffordanceNames(
  recentMessages: Message[],
  currentMessageId: string,
  clientUserId?: string | null,
): string[] {
  const toolNames: string[] = [];

  const lookbackMessages = recentMessages
    .filter((recentMessage) => recentMessage.id !== currentMessageId)
    .slice(-8)
    .reverse();

  for (const msg of lookbackMessages) {
    const isPersonaOutput = Boolean(msg.webhookId) || (Boolean(clientUserId) && msg.author.id === clientUserId);

    if (!isPersonaOutput) {
      const recentIntentResult = getDeliberateToolIntentResult(msg.content);
      toolNames.push(...recentIntentResult.allowedToolNames);
      if (toolNames.length > 0) break;
      continue;
    }

    const attachments = [...msg.attachments.values()];

    if (attachments.some((attachment) => isSnapshotAudioAttachment(attachment.contentType))) {
      toolNames.push("generate_voice_message");
    }

    if (attachments.some((attachment) => isSnapshotImageAttachment(attachment.contentType))) {
      toolNames.push("generate_image", "generate_image_nai");
    }

    if (attachments.some((attachment) => isSnapshotVideoAttachment(attachment.contentType))) {
      toolNames.push("generate_video");
    }

    if (toolNames.length > 0) break;
  }

  return Array.from(new Set(toolNames));
}

async function buildSnapshotToolFilter(params: {
  messagesArray: Message[];
  clientUserId?: string | null;
  persona: TomoriState;
  invokingUserData: UserRow;
}): Promise<SnapshotToolFilter | null> {
  const { messagesArray, clientUserId, persona, invokingUserData } = params;
  const latestUserMessage = [...messagesArray]
    .reverse()
    .find((message) => !message.webhookId && message.author.id !== clientUserId);

  const latestUserRow =
    latestUserMessage && latestUserMessage.author.id !== invokingUserData.user_disc_id
      ? await getCachedUserRow(latestUserMessage.author.id)
      : invokingUserData;
  const deliberateToolModeActive = resolveDeliberateToolMode(
    persona.config.deliberate_tool_mode,
    latestUserRow?.personal_deliberate_tool_mode ?? "follow",
  );

  if (!deliberateToolModeActive) return null;

  const intentText = latestUserMessage?.content ?? "";
  const directIntent = getDeliberateToolIntentResult(intentText, persona.config.deliberate_tool_triggers);
  const followUpIntent = getFollowUpToolIntentResult(
    intentText,
    latestUserMessage
      ? getSnapshotRecentToolAffordanceNames(messagesArray, latestUserMessage.id, clientUserId)
      : [],
  );
  const allowedToolNames = Array.from(new Set([...directIntent.allowedToolNames, ...followUpIntent.allowedToolNames]));

  return {
    disabledByDeliberateMode: allowedToolNames.length === 0,
    allowedToolNames,
  };
}

// ─── Subcommand registration ──────────────────────────────────────────────────

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("snapshot")
    .setDescription(localizer("en-US", "commands.tool.prompt.snapshot.description"))
    .addStringOption((option) =>
      option
        .setName("format")
        .setDescription(localizer("en-US", "commands.tool.prompt.snapshot.format_description"))
        .addChoices(
          { name: localizer("en-US", "commands.tool.prompt.snapshot.text_option"), value: "text" },
          { name: localizer("en-US", "commands.tool.prompt.snapshot.json_option"), value: "json" },
        ),
    )
    .addBooleanOption((option) =>
      option
        .setName("fetch_tools")
        .setDescription(localizer("en-US", "commands.tool.prompt.snapshot.fetch_tools_description")),
    );

// ─── Execute ──────────────────────────────────────────────────────────────────

/**
 * Dumps the compiled LLM prompt for a chosen persona + current channel to a file,
 * then sends it to the invoking user via DM (or as an ephemeral attachment if DMs are closed).
 *
 * @param client - Discord client instance
 * @param interaction - Command interaction (must be in a guild channel)
 * @param userData - Invoker's user row — passed to buildContext so STM loads correctly
 * @param locale - Resolved locale for the interaction
 */
export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // Unique modal ID per invocation prevents stale awaitModalSubmit collisions
  const MODAL_CUSTOM_ID = `tool_promptsnapshot_modal_${interaction.id}`;

  // 1. Require a guild channel — DM context cannot fetch server state
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.tool.prompt.snapshot.guild_only_title",
      descriptionKey: "commands.tool.prompt.snapshot.guild_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    // 2. Load server state for permission check
    const tomoriState = await getCachedTomoriState(interaction.guild.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 3. Permission gate — ManageGuild always bypasses; prompt_snapshot_enabled extends to non-admins
    const hasManageGuild = interaction.memberPermissions?.has("ManageGuild") ?? false;
    const snapshotEnabled = tomoriState.config.prompt_snapshot_enabled ?? false;
    if (!hasManageGuild && !snapshotEnabled) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.tool.prompt.snapshot.no_permission_title",
        descriptionKey: "commands.tool.prompt.snapshot.no_permission_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 4. Read optional format choice (defaults to "text") and fetch_tools flag
    const format = interaction.options.getString("format") ?? "text";
    const fetchTools = interaction.options.getBoolean("fetch_tools") ?? false;

    // 5. Load all server personas for the select modal
    const personas = await getCachedAllPersonas(interaction.guild.id);
    if (personas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.tool.prompt.snapshot.no_personas_title",
        descriptionKey: "commands.tool.prompt.snapshot.no_personas_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 6. Build persona select options — index-based values avoid Discord's 100-char value limit
    const personaOptions = personas.map((persona, index) => ({
      label: safeSelectOptionText(persona.tomori_nickname),
      value: index.toString(),
      description: persona.is_alter ? "Alter Persona" : "Main Persona",
    }));

    // 7. Show persona select modal — this is the first interaction acknowledgment;
    //    do NOT deferReply before this call
    const modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.tool.prompt.snapshot.modal_title",
      components: [
        {
          customId: PERSONA_SELECT_ID,
          labelKey: "commands.tool.prompt.snapshot.persona_select_label",
          descriptionKey: "commands.tool.prompt.snapshot.persona_select_description",
          placeholder: "commands.tool.prompt.snapshot.persona_select_placeholder",
          required: true,
          options: personaOptions,
        },
      ],
    });

    if (modalResult.outcome !== "submit" || !modalResult.interaction) return;
    const modalInteraction = modalResult.interaction;

    // 8. Defer modal submission before async work to prevent interaction timeout
    if (!modalInteraction.deferred && !modalInteraction.replied) {
      await modalInteraction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    // 9. Resolve the selected persona from the index value
    const selectedIndexStr = modalResult.values?.[PERSONA_SELECT_ID];
    const selectedIndex = selectedIndexStr !== undefined ? Number.parseInt(selectedIndexStr, 10) : 0;
    const selectedPersona: TomoriState | undefined = personas[selectedIndex];

    if (!selectedPersona) {
      await modalInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.tool.prompt.snapshot.build_failed_title"))
            .setDescription(localizer(locale, "commands.tool.prompt.snapshot.build_failed_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    // 9b. Resolve effective LLM (persona override > channel override > global) and
    //     patch samplers from saved_provider_configs when the override crosses providers.
    //     Mirrors the same resolution block in tomoriChat.ts so snapshot reflects exactly
    //     what the live pipeline would use.
    const channelLlmOverride = await getCachedChannelLlm(selectedPersona.server_id, interaction.channelId);
    const effectiveLlm = selectedPersona.persona_llm ?? channelLlmOverride ?? selectedPersona.llm;

    let effectivePersona = selectedPersona;
    if (effectiveLlm !== selectedPersona.llm) {
      effectivePersona = { ...selectedPersona, llm: effectiveLlm };

      const overrideProvider = effectiveLlm.llm_provider.toLowerCase();
      if (overrideProvider !== selectedPersona.llm.llm_provider.toLowerCase()) {
        const overrideSavedConfig = await loadSavedProviderConfig(selectedPersona.server_id, overrideProvider);
        if (overrideSavedConfig) {
          effectivePersona = {
            ...effectivePersona,
            config: {
              ...selectedPersona.config,
              llm_temperature: overrideSavedConfig.llm_temperature ?? selectedPersona.config.llm_temperature,
              llm_top_p: overrideSavedConfig.llm_top_p ?? selectedPersona.config.llm_top_p,
              llm_top_k: overrideSavedConfig.llm_top_k ?? selectedPersona.config.llm_top_k,
              llm_frequency_penalty:
                overrideSavedConfig.llm_frequency_penalty ?? selectedPersona.config.llm_frequency_penalty,
              llm_presence_penalty:
                overrideSavedConfig.llm_presence_penalty ?? selectedPersona.config.llm_presence_penalty,
              llm_min_p: overrideSavedConfig.llm_min_p ?? selectedPersona.config.llm_min_p,
              thinking_level: overrideSavedConfig.thinking_level ?? selectedPersona.config.thinking_level,
              llm_disabled_params:
                overrideSavedConfig.llm_disabled_params ?? selectedPersona.config.llm_disabled_params,
              llm_logit_biases: overrideSavedConfig.llm_logit_biases ?? selectedPersona.config.llm_logit_biases,
            },
          };
        }
      }
    }

    // 10. Fetch channel message history — same pattern as /tool estimate cost
    const textChannel = interaction.channel;
    if (!("messages" in textChannel)) {
      await modalInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.tool.prompt.snapshot.build_failed_title"))
            .setDescription(localizer(locale, "commands.tool.prompt.snapshot.build_failed_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    const messageFetchLimit = normalizeMessageFetchLimit(selectedPersona.config.message_fetch_limit);
    const fetchedMessages = await textChannel.messages.fetch({ limit: messageFetchLimit });
    const allMessagesArray = Array.from(fetchedMessages.values()).reverse();

    // 10a. Respect /refresh and /compact_refresh boundaries — same slicing logic
    //      used by the live chat pipeline in tomoriChat.ts so snapshot reflects
    //      exactly what the LLM would actually see
    const { sliced: messagesArray } = sliceMessagesAtResetMarker(allMessagesArray);
    const snapshotToolFilter = fetchTools && format === "json"
      ? await buildSnapshotToolFilter({
          messagesArray,
          clientUserId: client.user?.id,
          persona: effectivePersona,
          invokingUserData: userData,
        })
      : null;

    // 11. Build persona nickname index for webhook attribution
    const personaByNickname = new Map<string, TomoriState>();
    for (const p of personas) {
      if (!p.tomori_nickname) continue;
      const key = p.tomori_nickname.toLowerCase();
      if (!personaByNickname.has(key)) personaByNickname.set(key, p);
    }
    const mainPersona = personas.find((p) => !p.is_alter) ?? tomoriState;

    // 12. Convert Discord messages to simplified context format
    type SimpleMsg = {
      id: string;
      authorId: string;
      authorName: string;
      authorType: "user" | "persona";
      personaName?: string | null;
      content: string | null;
      mediaSourceMessageIds?: string[];
      imageAttachments: Array<{
        url: string;
        proxyUrl: string;
        mimeType: string | null;
        filename: string;
        isEmoji?: boolean;
      }>;
      videoAttachments: Array<{
        url: string;
        proxyUrl: string;
        mimeType: string | null;
        filename: string;
        isYouTubeLink: boolean;
      }>;
    };

    const simplifiedMessages: SimpleMsg[] = [];
    const userListSet = new Set<string>();

    for (const message of messagesArray) {
      // Skip fully-private users (same gate as real context building)
      if (!message.webhookId) {
        const privacyLevel = await getCachedPrivacyLevel(message.author.id);
        if (privacyLevel === PrivacyLevel.FULL) continue;
      }

      let effectiveAuthorId = message.author.id;
      let authorName = `<@${message.author.id}>`;
      let authorType: "user" | "persona" = "user";
      let personaName: string | null = null;

      if (message.author.id === client.user?.id) {
        authorName = mainPersona.tomori_nickname ?? tomoriState.tomori_nickname ?? message.author.username;
        authorType = "persona";
        personaName = authorName;
      } else if (message.webhookId) {
        const webhookName = message.author.username?.trim();
        const matchedPersona = webhookName ? personaByNickname.get(webhookName.toLowerCase()) : undefined;
        if (matchedPersona) {
          authorName = matchedPersona.tomori_nickname;
          authorType = "persona";
          personaName = matchedPersona.tomori_nickname;
          effectiveAuthorId = `persona:${matchedPersona.tomori_id ?? matchedPersona.tomori_nickname}`;
        } else if (webhookName) {
          authorName = webhookName;
        }
      }

      const imageAttachments: SimpleMsg["imageAttachments"] = [];
      const videoAttachments: SimpleMsg["videoAttachments"] = [];
      let hasLocalMedia = false;

      for (const att of message.attachments.values()) {
        if (att.contentType?.startsWith("image/")) {
          imageAttachments.push({
            url: att.url,
            proxyUrl: att.proxyURL,
            mimeType: att.contentType,
            filename: att.name,
          });
          hasLocalMedia = true;
        } else if (att.contentType?.startsWith("video/")) {
          videoAttachments.push({
            url: att.url,
            proxyUrl: att.proxyURL,
            mimeType: att.contentType,
            filename: att.name,
            isYouTubeLink: false,
          });
          hasLocalMedia = true;
        }
      }

      for (const sticker of message.stickers.values()) {
        const stickerUrl = `https://cdn.discordapp.com/stickers/${sticker.id}.png`;
        imageAttachments.push({
          url: stickerUrl,
          proxyUrl: stickerUrl,
          mimeType: "image/png",
          filename: `${sticker.name}.png`,
        });
        hasLocalMedia = true;
      }

      if (message.content) {
        for (const pattern of YOUTUBE_URL_PATTERNS) {
          const match = message.content.match(pattern);
          if (!match) continue;
          videoAttachments.push({
            url: match[0],
            proxyUrl: match[0],
            mimeType: "video/youtube",
            filename: `youtube_video_${match[1]}.mp4`,
            isYouTubeLink: true,
          });
          hasLocalMedia = true;
          break;
        }
      }

      // Process embeds to match tomoriChat.ts conversion rules:
      //   a) System-produced embeds (memory_learning, reminder_set, system_injection,
      //      compact_summary/refresh, reward, punish) are wrapped as `[System: ...]`
      //      blocks and appended to message content — this applies to ALL messages.
      //   b) Link-preview embeds (Twitter/YouTube/articles) are extracted as
      //      `[System: Link preview embed content: ...]` and their images are added
      //      to imageAttachments — ONLY for non-Tomori-authored messages.
      const botNickname = mainPersona.tomori_nickname ?? tomoriState.tomori_nickname ?? null;
      const isTomoriAuthored = message.author.id === client.user?.id;
      const embedTextSegments: string[] = [];
      if (message.embeds.length > 0) {
        for (const embed of message.embeds) {
          const embedCheck = checkTargetEmbedTitle(embed.title);
          if (embedCheck.isTarget && embed.description) {
            const type = embedCheck.type;
            if (type === "system_injection" || type === "compact_summary" || type === "compact_refresh") {
              // 1. System injection / compact summary / compact refresh — bare [System:] wrapper
              const titleLine =
                (type === "compact_summary" || type === "compact_refresh") && embed.title ? `## ${embed.title}\n` : "";
              embedTextSegments.push(`[System: ${titleLine}${embed.description}]`);
            } else {
              // 2. Strip bot-name prefix (e.g., "Tomori: foo" → "foo") for non-system-injection kinds
              let cleanedDescription = embed.description;
              if (botNickname) {
                const escapedNickname = botNickname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const botNamePattern = new RegExp(`^${escapedNickname}:\\s*`, "i");
                if (botNamePattern.test(cleanedDescription)) {
                  cleanedDescription = cleanedDescription.replace(botNamePattern, "").trim();
                }
              }
              const includeTitle = type === "memory_learning" || type === "reminder_set";
              const titleLine = includeTitle && embed.title ? `${embed.title}\n` : "";
              const embedBody = `${titleLine}${cleanedDescription}`;
              // 3. memory_learning / reward / punish → plain [System: ...];
              //    reminder_set → formatSystemProducedEmbedHint
              embedTextSegments.push(
                type === "memory_learning" || type === "reward" || type === "punish"
                  ? `[System: ${embedBody}]`
                  : formatSystemProducedEmbedHint(embedBody),
              );
            }
          } else if (!isTomoriAuthored) {
            // 4. Link preview extraction for non-bot messages
            const linkEmbedData = processLinkEmbed(embed);
            if (linkEmbedData.isLinkPreview) {
              if (linkEmbedData.textContent) embedTextSegments.push(linkEmbedData.textContent);
              if (linkEmbedData.imageInfo) {
                imageAttachments.push({
                  url: linkEmbedData.imageInfo.url,
                  proxyUrl: linkEmbedData.imageInfo.proxyUrl,
                  mimeType: linkEmbedData.imageInfo.mimeType,
                  filename: linkEmbedData.imageInfo.filename,
                });
                hasLocalMedia = true;
              }
              if (linkEmbedData.thumbnailInfo) {
                imageAttachments.push({
                  url: linkEmbedData.thumbnailInfo.url,
                  proxyUrl: linkEmbedData.thumbnailInfo.proxyUrl,
                  mimeType: linkEmbedData.thumbnailInfo.mimeType,
                  filename: linkEmbedData.thumbnailInfo.filename,
                });
                hasLocalMedia = true;
              }
            }
          }
        }
      }

      // Merge embed-derived text into the message content (appended after original text)
      const baseContent = message.content?.trim() ? message.content : "";
      const combinedContent = [baseContent, ...embedTextSegments].filter((s) => s.length > 0).join("\n");
      const messageContent = combinedContent.length > 0 ? combinedContent : null;
      const mediaSourceMessageIds = hasLocalMedia ? [message.id] : undefined;

      // Merge consecutive messages from the same author (same as real context building)
      const prevMsg = simplifiedMessages[simplifiedMessages.length - 1];
      if (prevMsg && prevMsg.authorId === effectiveAuthorId && prevMsg.content && messageContent) {
        prevMsg.content += `\n${messageContent}`;
        if (imageAttachments.length > 0) prevMsg.imageAttachments.push(...imageAttachments);
        if (videoAttachments.length > 0) prevMsg.videoAttachments.push(...videoAttachments);
        if (mediaSourceMessageIds?.length) {
          prevMsg.mediaSourceMessageIds = [
            ...new Set([...(prevMsg.mediaSourceMessageIds ?? []), ...mediaSourceMessageIds]),
          ];
        }
      } else if (messageContent || imageAttachments.length > 0 || videoAttachments.length > 0) {
        simplifiedMessages.push({
          id: message.id,
          authorId: effectiveAuthorId,
          authorName,
          authorType,
          personaName,
          content: messageContent,
          mediaSourceMessageIds,
          imageAttachments,
          videoAttachments,
        });
      }

      userListSet.add(effectiveAuthorId);
    }

    if (client.user?.id) userListSet.add(client.user.id);

    const isDMChannel = !interaction.guildId;
    const channelName =
      "name" in textChannel && typeof textChannel.name === "string" ? textChannel.name : "unknown-channel";
    const channelDesc = "topic" in textChannel ? (textChannel.topic as string | null) : null;

    // 13. Assemble context using the selected persona — buildContext handles preset routing internally
    const contextBuild = await buildContext({
      guildId: interaction.guild.id,
      serverName: interaction.guild.name,
      serverDescription: interaction.guild.description || null,
      simplifiedMessageHistory: simplifiedMessages,
      userList: Array.from(userListSet),
      matrixUsers: new Map<string, string>(),
      syntheticUsers: new Map<string, { displayName: string; type: "persona" | "webhook" }>(),
      channelDesc,
      channelName,
      channelId: interaction.channelId,
      // Thread → parent-channel privacy inheritance (mirrors tomoriChat.ts)
      parentChannelId: textChannel.isThread() ? textChannel.parentId : null,
      client,
      triggererName: interaction.user.displayName || interaction.user.globalName || interaction.user.username,
      // snapshot.triggererUserRow unlocks STM context (actualTriggeringUserId guard inside buildContext)
      snapshot: { triggererUserRow: userData, tomoriState: effectivePersona },
      tomoriNickname: selectedPersona.tomori_nickname ?? process.env.DEFAULT_BOTNAME ?? "Tomori",
      tomoriAttributes: selectedPersona.attribute_list,
      tomoriConfig: effectivePersona.config,
      personaPrompt: selectedPersona.persona_prompt ?? null,
      personaLineageId: selectedPersona.persona_lineage_id,
      isDMChannel,
      seesImages: effectiveLlm.sees_images,
      seesVideos: effectiveLlm.sees_videos,
    });

    // Mutable copy — tail directives are spliced/pushed in below
    const contextItems = [...contextBuild.contextItems];

    // 13a. Apply tail directives in the same order as the live chat pipeline so the
    //      snapshot reflects the full prompt the LLM would actually see:
    //        1. Lower-priority tails (STM "create" prompt, emoji penalty) inserted
    //           before the latest dialogue pair so they don't displace recent turns.
    //        2. Normal tails (e.g. impersonation directive) appended to the end.
    //        3. Uncensor directive appended last (isolated, strongest recency signal).
    const lowerPriorityTailDirectives = [...contextBuild.lowerPriorityTailDirectives];
    const emojiPenaltyDirective = getEmojiPenaltyDirective(
      contextItems,
      selectedPersona.tomori_nickname ?? process.env.DEFAULT_BOTNAME ?? "Tomori",
    );
    if (emojiPenaltyDirective) lowerPriorityTailDirectives.push(emojiPenaltyDirective);

    const lowerPriorityTailMessage = buildCombinedTailDirectiveMessage(lowerPriorityTailDirectives);
    if (lowerPriorityTailMessage) insertBeforeLatestDialoguePair(contextItems, lowerPriorityTailMessage);

    const combinedTailMessage = buildCombinedTailDirectiveMessage([...contextBuild.tailDirectives]);
    if (combinedTailMessage) contextItems.push(combinedTailMessage);

    if (contextBuild.uncensorDirective) {
      const uncensorTailMessage = buildCombinedTailDirectiveMessage([contextBuild.uncensorDirective]);
      if (uncensorTailMessage) contextItems.push(uncensorTailMessage);
    }

    // 14. Retrieve the active preset name for the snapshot header
    const presetData = await getCachedActivePreset(selectedPersona.server_id);
    const presetName = presetData?.preset.preset_name ?? null;

    // 15. Resolve effective model — already computed as effectiveLlm above (step 9b)
    const providerName = normalizeProviderName(effectiveLlm.llm_provider);
    const modelName = effectiveLlm.llm_codename;
    const timestamp = new Date().toISOString();

    // 16. Optionally fetch provider-formatted tool definitions (JSON output only).
    //     TXT format intentionally omits tools — users are directed to use JSON for tools.
    let toolsData: Array<Record<string, unknown>> | null = null;
    if (fetchTools && format === "json") {
      try {
        toolsData = await fetchProviderTools(effectivePersona, providerName, snapshotToolFilter);
      } catch (toolError) {
        log.warn(
          `Failed to fetch tools for prompt snapshot (provider=${providerName}): ${(toolError as Error).message}`,
        );
      }
    }

    // 16b. Build per-provider sampling/request-config block
    //      Shown in DM for BOTH formats and baked into JSON file top-level
    const requestConfig = buildRequestConfig(effectivePersona, providerName, modelName);

    // 17. Build snapshot file content
    let fileContent: string;
    let fileName: string;

    if (format === "json") {
      const snapshotData = await buildJsonSnapshot(
        contextItems,
        effectivePersona,
        providerName,
        modelName,
        toolsData,
        requestConfig,
      );
      fileContent = JSON.stringify(snapshotData, null, 2);
      fileName = `prompt-snapshot-${interaction.channelId}-${selectedPersona.persona_lineage_id}-${Date.now()}.json`;
    } else {
      fileContent = buildTextSnapshot(contextItems);
      fileName = `prompt-snapshot-${interaction.channelId}-${selectedPersona.persona_lineage_id}-${Date.now()}.txt`;
    }

    // 18. Create the attachment buffer
    const attachment = new AttachmentBuilder(Buffer.from(fileContent, "utf-8"), { name: fileName });
    const formatLabel = format === "json" ? "JSON" : "Text";

    // 19. Compose the DM description — intro + metadata code block + format-switch hint
    //     + (TXT) note about `=== === ` headers being annotations
    //     + (TXT + fetch_tools) note that tools are JSON-only
    const descriptionParts: string[] = [];
    descriptionParts.push(
      localizer(locale, "commands.tool.prompt.snapshot.dm_description", {
        persona_name: selectedPersona.tomori_nickname,
        format: formatLabel,
      }),
    );
    descriptionParts.push(
      [
        "```yaml",
        `server_id: ${interaction.guild.id}`,
        `channel: #${channelName}`,
        `persona: ${selectedPersona.tomori_nickname}`,
        `provider: ${providerName}`,
        `model: ${modelName}`,
        `preset: ${presetName ?? "(native)"}`,
        `captured: ${timestamp}`,
        "```",
      ].join("\n"),
    );
    // Second code block: per-provider sampling/request config (shown in both TXT and JSON formats)
    descriptionParts.push(
      [
        localizer(locale, "commands.tool.prompt.snapshot.dm_config_heading"),
        "```json",
        JSON.stringify(requestConfig, null, 2),
        "```",
      ].join("\n"),
    );
    if (format === "text") {
      descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.dm_txt_headers_note"));
      descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.dm_hint_try_json"));
      if (fetchTools) {
        descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.dm_tools_txt_note"));
      }
    } else {
      descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.dm_hint_try_text"));
      if (fetchTools) {
        descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.dm_tools_filtering_note"));
      }
    }
    const dmDescription = descriptionParts.join("\n\n");

    // 20. DM the file; fall back to ephemeral attachment if DMs are closed
    try {
      await interaction.user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.tool.prompt.snapshot.dm_title"))
            .setDescription(dmDescription)
            .setColor(ColorCode.INFO),
        ],
        files: [attachment],
      });

      await modalInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.tool.prompt.snapshot.success_title"))
            .setDescription(localizer(locale, "commands.tool.prompt.snapshot.success_description"))
            .setColor(ColorCode.SUCCESS),
        ],
      });
    } catch (dmError) {
      log.warn(`Failed to DM prompt snapshot to user ${interaction.user.id}:`, dmError as Error);
      await modalInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.tool.prompt.snapshot.dm_failed_title"))
            .setDescription(
              `${localizer(locale, "commands.tool.prompt.snapshot.dm_failed_description")}\n\n${dmDescription}`,
            )
            .setColor(ColorCode.WARN),
        ],
        files: [attachment],
      });
    }
  } catch (error) {
    log.error("Error executing /tool prompt snapshot:", error as Error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "tool prompt snapshot", guildId: interaction.guild?.id },
    });

    if (!interaction.replied && !interaction.deferred) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

// ─── Tag → user-facing label mapping ─────────────────────────────────────────

/**
 * Human-readable label (and optional command hint) for each `ContextItemTag`.
 * Rendered by `buildTextSnapshot` as `=== Title (command/system-managed) ===` blocks.
 *
 * `subsections` lets a single context item — especially composites like
 * `KNOWLEDGE_USERS_IN_CONVERSATION` — expose multiple `== SubTitle ==` markers
 * so users can see which separate data pools feed into that block.
 */
type TagLabel = {
  title: string;
  hint: string; // Slash-command reference like `/config system-prompt`, or the literal "system-managed"
  subsections?: Array<{ title: string; hint: string }>;
};

const TAG_LABELS: Record<string, TagLabel> = {
  [ContextItemTag.SYSTEM_INSTRUCTION_BLOCK]: { title: "System Instruction Block", hint: "system-managed" },
  [ContextItemTag.SYSTEM_PERSONALITY]: { title: "Persona Attributes", hint: "/persona attribute" },
  [ContextItemTag.SYSTEM_HUMANIZER_RULES]: { title: "System Prompt", hint: "/config system-prompt" },
  [ContextItemTag.SYSTEM_FUNCTION_GUIDE]: { title: "Function Guide", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_SERVER_INFO]: { title: "Discord Server Info", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_SERVER_EMOJIS]: { title: "Server Emojis", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_SERVER_STICKERS]: { title: "Server Stickers", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_SERVER_MEMORIES]: { title: "Server Memories", hint: "/memory server" },
  [ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS]: { title: "Server Documents", hint: "/memory document add" },
  [ContextItemTag.KNOWLEDGE_SERVER_CONDITIONING]: { title: "Conditioning Log", hint: "/conditioning" },
  [ContextItemTag.KNOWLEDGE_USER_MEMORIES]: { title: "Personal Memories", hint: "/memory personal" },
  [ContextItemTag.KNOWLEDGE_USER_STATUS]: { title: "Discord Presence", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_CURRENT_CONTEXT]: { title: "Current Context", hint: "system-managed" },
  [ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION]: {
    title: "Info on Users in Context",
    hint: "composite",
    subsections: [
      { title: "Personal/Server Memories", hint: "/memory" },
      { title: "Discord Presence/Role/Channel", hint: "system-managed" },
    ],
  },
  [ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY]: { title: "Short-Term Memory", hint: "/server stm manage" },
  [ContextItemTag.DIALOGUE_SAMPLE]: { title: "Sample Dialogue", hint: "/persona sample-dialogue" },
  [ContextItemTag.DIALOGUE_HISTORY]: { title: "Conversation History", hint: "system-managed" },
  [ContextItemTag.CONTEXT_NOTE_INJECTION]: { title: "Context Note", hint: "/config context-note" },
};

function renderTagHeader(tag: string | undefined): string {
  if (!tag) return "=== Untagged (system-managed) ===";
  const label = TAG_LABELS[tag];
  if (!label) return `=== ${tag} (system-managed) ===`;

  const lines: string[] = [];
  // 1. Main title — composite tags use just the title since sub-sections carry the hints
  if (label.hint === "composite") {
    lines.push(`=== ${label.title} ===`);
  } else if (label.hint === "system-managed") {
    lines.push(`=== ${label.title} (system-managed) ===`);
  } else {
    lines.push(`=== ${label.title} (\`${label.hint}\`) ===`);
  }
  // 2. Sub-sections (if any) — composite tags like KNOWLEDGE_USERS_IN_CONVERSATION list their feeders
  if (label.subsections) {
    for (const sub of label.subsections) {
      if (sub.hint === "system-managed") {
        lines.push(`== ${sub.title} (system-managed) ==`);
      } else {
        lines.push(`== ${sub.title} (\`${sub.hint}\`) ==`);
      }
    }
  }
  return lines.join("\n");
}

// ─── Text formatter ───────────────────────────────────────────────────────────

/**
 * Serializes `contextItems` (already rearranged by preset routing, if applicable) into
 * a human-readable flat-text format that mirrors the order produced by `buildContext`.
 *
 * Each context item gets a `=== Title (/command) ===` header derived from its
 * `metadataTag`. These headers are annotations — they are NOT part of the prompt
 * actually sent to the LLM. The DM body that ships with the file explains this.
 */
function buildTextSnapshot(contextItems: StructuredContextItem[]): string {
  const lines: string[] = [];

  for (const item of contextItems) {
    lines.push(renderTagHeader(item.metadataTag));

    for (const part of item.parts) {
      if (part.type === "text") {
        lines.push(part.text);
      } else if (part.type === "image") {
        // Estimate byte size from data URI length (base64 overhead ~1.33×)
        const byteEstimate = part.uri.startsWith("data:")
          ? Math.round(((part.uri.length - part.uri.indexOf(",") - 1) * 3) / 4)
          : 0;
        const sizeLabel = byteEstimate > 0 ? `~${byteEstimate} bytes` : "URL";
        lines.push(`[IMAGE: ${part.mimeType}, ${sizeLabel}, hidden]`);
      } else if (part.type === "video") {
        const ytSuffix = part.isYouTubeLink ? ", YouTube" : "";
        lines.push(`[VIDEO: ${part.mimeType}${ytSuffix}, hidden]`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ─── JSON formatter ───────────────────────────────────────────────────────────

/**
 * Produces a provider-specific JSON snapshot that matches the format emitted by
 * each adapter's `logSanitizedRequest` to terminal. Base64 image data is redacted
 * to keep file sizes manageable, matching the terminal log sanitization.
 *
 * Supported providers with full native fidelity:
 *   - google            → GoogleStreamAdapter.buildTokenCountPayload
 *   - vertex            → VertexStreamAdapter.buildTokenCountPayload
 *   - vertexexpress     → VertexexpressStreamAdapter.buildTokenCountPayload
 *   - openrouter-family → OpenrouterStreamAdapter.buildProbeMessages
 *   - anthropic         → AnthropicStreamAdapter.buildProbeMessages
 *
 * All other providers (novelai, custom, etc.) fall back to a flat OpenAI-style
 * `{model, messages: [{role, content}]}` shape. Messages with media use the
 * OpenAI-vision array-content form; text-only messages use plain strings.
 *
 * Metadata (server/channel/persona/provider/preset) is NOT embedded in the file —
 * it is rendered in the DM body instead, to keep the file focused on payload.
 *
 * When `toolsData` is provided, a top-level `tools` key is appended in the same
 * shape the adapter would send to the provider.
 */
async function buildJsonSnapshot(
  contextItems: StructuredContextItem[],
  persona: TomoriState,
  providerName: string,
  modelName: string,
  toolsData: Array<Record<string, unknown>> | null,
  requestConfig: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const activeLlm = persona.persona_llm ?? persona.llm;
  const seesImages = activeLlm.sees_images;
  const seesVideos = activeLlm.sees_videos;

  let requestData: Record<string, unknown>;

  if (providerName === "google" || providerName === "vertex" || providerName === "vertexexpress") {
    // 1. Assemble context into Google/Vertex Content[] format
    const adapter =
      providerName === "google"
        ? new GoogleStreamAdapter()
        : providerName === "vertex"
          ? new VertexStreamAdapter()
          : new VertexexpressStreamAdapter();
    const payload = await adapter.buildTokenCountPayload(contextItems, modelName);

    // 2. Sanitize — replace inlineData.data (base64) with placeholder (mirrors logSanitizedRequest)
    const sanitizedContents = payload.contents.map((content) => ({
      ...content,
      // biome-ignore lint/suspicious/noExplicitAny: Google Part type lacks index signature; cast needed for sanitization
      parts: ((content.parts ?? []) as Array<any>).map((part: Record<string, unknown>) => {
        if ("inlineData" in part && part.inlineData) {
          const inlineData = part.inlineData as Record<string, unknown>;
          return { inlineData: { mimeType: inlineData.mimeType, data: "[BASE64_HIDDEN]" } };
        }
        return part;
      }),
    }));

    requestData = {
      model: modelName,
      systemInstruction: payload.systemInstruction,
      contents: sanitizedContents,
    };
  } else if (
    providerName === "openrouter" ||
    providerName === "deepseek" ||
    providerName === "zai" ||
    providerName === "zaicoding" ||
    providerName === "nvidia"
  ) {
    // 1. Assemble context into OpenAI-compatible messages format
    const adapter = new OpenrouterStreamAdapter();
    const messages = await adapter.buildProbeMessages(contextItems, seesImages, seesVideos);

    // 2. Sanitize — replace data-URI image_url values (mirrors logSanitizedRequest)
    const sanitized = messages.map((msg: Record<string, unknown>) => {
      if (!Array.isArray(msg.content)) return msg;
      return {
        ...msg,
        content: (msg.content as Array<Record<string, unknown>>).map((part) => {
          if (part.type === "image_url") {
            const imageUrl = (part as { image_url?: { url?: string } }).image_url;
            if (imageUrl?.url?.startsWith("data:")) {
              return { type: "image_url", image_url: { ...imageUrl, url: "[BASE64_HIDDEN]" } };
            }
          }
          return part;
        }),
      };
    });

    requestData = { model: modelName, messages: sanitized };
  } else if (providerName === "anthropic") {
    // 1. Assemble context into Anthropic system + messages format
    const adapter = new AnthropicStreamAdapter();
    const { system, messages } = await adapter.buildProbeMessages(contextItems, seesImages);

    // 2. Sanitize — replace base64 image source.data (mirrors logSanitizedRequest)
    const sanitizedMessages = messages.map((msg: Record<string, unknown>) => {
      const content = msg.content;
      if (typeof content === "string") return msg;
      const sanitizedContent = (content as Array<Record<string, unknown>>).map((block) => {
        if (
          block.type === "image" &&
          block.source &&
          typeof (block.source as Record<string, unknown>).data === "string"
        ) {
          return { ...block, source: { ...(block.source as Record<string, unknown>), data: "[BASE64_HIDDEN]" } };
        }
        return block;
      });
      return { ...msg, content: sanitizedContent };
    });

    requestData = { model: modelName, system, messages: sanitizedMessages };
  } else {
    // Fallback for providers without a public probe builder (novelai, custom, etc.):
    // flatten `contextItems` into a plain `{model, messages: [{role, content}]}` shape.
    // Role remap: `model` → `assistant` to match OpenAI conventions.

    // 1. Consolidate all system items into a single leading entry
    //    OpenAI-compatible APIs only accept one `role: "system"` message,
    //    so we flatten multiple system blocks (personality, rules, knowledge, etc.)
    //    by joining their text parts with "\n\n" into one entry.
    const systemTextChunks: string[] = [];
    const nonSystemItems: StructuredContextItem[] = [];
    for (const item of contextItems) {
      if (item.role === "system") {
        const text = item.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        if (text.trim()) systemTextChunks.push(text);
      } else {
        nonSystemItems.push(item);
      }
    }

    const messagesList: Array<Record<string, unknown>> = [];
    if (systemTextChunks.length > 0) {
      messagesList.push({ role: "system", content: systemTextChunks.join("\n\n") });
    }

    // 2. Map the remaining non-system items to OpenAI-style messages
    for (const item of nonSystemItems) {
      const role = item.role === "model" ? "assistant" : item.role;
      const hasMedia = item.parts.some((p) => p.type !== "text");

      if (!hasMedia) {
        // 2a. Text-only: plain string content
        const text = item.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        messagesList.push({ role, content: text });
        continue;
      }

      // 2b. Mixed media: OpenAI-vision array-content form
      const content = item.parts.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "image") {
          return { type: "image_url", image_url: { url: "[MEDIA_HIDDEN]" }, mime_type: part.mimeType };
        }
        // video
        return {
          type: "video_url",
          video_url: { url: "[MEDIA_HIDDEN]" },
          mime_type: part.mimeType,
          ...(part.isYouTubeLink ? { youtube: true } : {}),
        };
      });
      messagesList.push({ role, content });
    }

    requestData = { model: modelName, messages: messagesList };
  }

  // 3. Merge per-provider sampling/request config into the top level.
  //    For Google/Vertex we nest under existing keys (`generation_config`, `safety_settings`, etc.)
  //    so the shape continues to match what the adapter would send. For Anthropic and
  //    OpenAI-compat we just spread onto the root object.
  for (const [key, value] of Object.entries(requestConfig)) {
    if (!(key in requestData)) requestData[key] = value;
  }

  // 4. Append provider-formatted tools when requested, including an empty list
  //    when per-turn filtering deliberately suppresses every tool.
  if (toolsData) {
    requestData.tools = toolsData;
  }

  return requestData;
}

// ─── Tool fetcher ─────────────────────────────────────────────────────────────

/**
 * Resolves the tool adapter matching the given provider. Non-OpenAI providers
 * (google/vertex/vertexexpress/anthropic) have dedicated adapters; OpenAI-compatible providers
 * share the openrouter-style adapter via subclasses. NovelAI keeps its own.
 * Unknown providers fall back to the OpenRouter adapter for OpenAI-compat shape.
 */
function selectToolAdapter(providerName: string): MCPCapableToolAdapter {
  switch (providerName) {
    case "google":
      return getGoogleToolAdapter();
    case "vertex":
      return getVertexToolAdapter();
    case "vertexexpress":
      return getVertexexpressToolAdapter();
    case "anthropic":
      return getAnthropicToolAdapter();
    case "openrouter":
      return getOpenrouterToolAdapter();
    case "deepseek":
      return getDeepseekToolAdapter();
    case "zai":
      return getZaiToolAdapter();
    case "zaicoding":
      return getZaicodingToolAdapter();
    case "nvidia":
      return getNvidiaToolAdapter();
    case "novelai":
      return getNovelaiToolAdapter();
    case "custom":
      return getCustomToolAdapter();
    default:
      return getOpenrouterToolAdapter();
  }
}

/**
 * Mirrors the tool-list assembly that `<Provider>Provider.getTools` does at
 * runtime, including the deliberate-mode per-turn allowlist when it can be
 * reconstructed from the latest visible user message. Returns the provider's
 * native tool JSON (OpenAI function spec for OpenAI-compat, Gemini schema for
 * Google, etc.).
 */
async function fetchProviderTools(
  persona: TomoriState,
  providerName: string,
  toolFilter?: SnapshotToolFilter | null,
): Promise<Array<Record<string, unknown>>> {
  const activeLlm = persona.persona_llm ?? persona.llm;

  if (!activeLlm.has_tools || toolFilter?.disabledByDeliberateMode) {
    return [];
  }

  const toolStateForContext: ToolStateForContext = {
    server_id: persona.server_id.toString(),
    activePersonaHasElevenlabsVoice: Boolean(
      persona.speech_voice_sample_id ||
        persona.speech_voice_design_prompt?.trim() ||
        persona.speech_voice_id?.trim() ||
        persona.elevenlabs_voice_id?.trim(),
    ),
    activePersonaVoiceDesignPrompt: persona.speech_voice_design_prompt?.trim() || null,
    activePersonaVoiceName: persona.speech_voice_name,
    llm: {
      llm_codename: activeLlm.llm_codename,
      has_tools: activeLlm.has_tools,
      sees_images: activeLlm.sees_images,
      sees_videos: activeLlm.sees_videos,
      sees_youtube: activeLlm.sees_youtube,
      supports_structoutput: activeLlm.supports_structoutput,
    },
    diffusion_model_id: persona.config.diffusion_model_id,
    nai_diffusion_model_id: persona.config.nai_diffusion_model_id,
    video_model_id: persona.config.video_model_id,
    config: {
      sticker_usage_enabled: persona.config.sticker_usage_enabled,
      web_search_enabled: persona.config.web_search_enabled,
      self_teaching_enabled: persona.config.self_teaching_enabled,
      manage_message_enabled: persona.config.manage_message_enabled,
      imagegen_enabled: persona.config.imagegen_enabled,
      videogen_enabled: persona.config.videogen_enabled,
      nai_exclusive_imggen: persona.config.nai_exclusive_imggen,
      voice_message_enabled: persona.config.voice_message_enabled,
      thread_creation_enabled: persona.config.thread_creation_enabled,
    },
  };

  // 1. Ask registry which built-in tools + MCP functions pass feature-flag gates
  let { builtInTools, mcpFunctionNames } = await getAvailableToolsWithMCP(providerName, toolStateForContext);

  if (toolFilter?.allowedToolNames.length) {
    const allowedSet = new Set(toolFilter.allowedToolNames);
    builtInTools = builtInTools.filter((tool) => allowedSet.has(tool.name));
    mcpFunctionNames = filterDeliberateToolNames(mcpFunctionNames, toolFilter.allowedToolNames);
  }

  // 2. Route through the provider adapter to get native tool shape
  const adapter = selectToolAdapter(providerName);
  return adapter.getAllToolsInProviderFormat(builtInTools, persona.server_id, mcpFunctionNames);
}

// ─── Request-config builder ──────────────────────────────────────────────────

/**
 * Produces a provider-specific sampling/request-config block matching what each
 * adapter would actually send at runtime. UNFILTERED: does not probe OpenRouter
 * for `supportedParameters`, so params the model may reject are still shown.
 *
 * Provider shapes:
 *   - google           : `{temperature, top_k, top_p, frequency_penalty, presence_penalty, max_output_tokens, stop_sequences, safety_settings, thinking_config?}`
 *   - vertex / vertexexpress: `{temperature, top_k, top_p, max_output_tokens, stop_sequences, safety_settings, thinking_config?}`
 *   - anthropic        : `{temperature?, top_p?, top_k?, max_tokens, stop_sequences}` (Anthropic rejects sending both temp+top_p — uses `selectAnthropicSamplingParams`)
 *   - openai-compat    : `{temperature?, top_p?, top_k?, frequency_penalty?, presence_penalty?, min_p?, max_tokens, stop}`
 *
 * Used in two places:
 *   1. Baked into the JSON snapshot file at the top level (alongside `messages`/`contents`)
 *   2. Rendered as a second ```json code block in the DM body (shown for BOTH text and JSON formats)
 */
function buildRequestConfig(persona: TomoriState, providerName: string, modelName: string): Record<string, unknown> {
  const activeLlm = persona.persona_llm ?? persona.llm;
  const config = persona.config;
  const disabledParams = config.llm_disabled_params ?? [];

  if (providerName === "google") {
    // 1. Google: show raw configured values (unfiltered, mirrors GoogleProviderConfig)
    const maxOutputTokens =
      config.llm_max_output_tokens ?? Number.parseInt(process.env.GOOGLE_MAX_OUTPUT_TOKENS || "8192", 10);
    const out: Record<string, unknown> = {
      generation_config: {
        temperature: config.llm_temperature,
        top_k: config.llm_top_k,
        top_p: config.llm_top_p,
        frequency_penalty: config.llm_frequency_penalty,
        presence_penalty: config.llm_presence_penalty,
        max_output_tokens: maxOutputTokens,
        stop_sequences: [],
      },
      safety_settings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    };
    const thinkingConfig = serializeGoogleThinkingConfig(buildGoogleThinkingConfig(modelName, config.thinking_level));
    if (thinkingConfig) out.thinking_config = thinkingConfig;
    if (disabledParams.length > 0) out.disabled_params = disabledParams;
    return out;
  }

  if (providerName === "vertex" || providerName === "vertexexpress") {
    // 2. Vertex family: mirrors VertexProvider/VertexexpressProvider request config
    const maxOutputTokens =
      config.llm_max_output_tokens ?? Number.parseInt(process.env.GOOGLE_MAX_OUTPUT_TOKENS || "8192", 10);
    const out: Record<string, unknown> = {
      generation_config: {
        temperature: config.llm_temperature,
        top_k: config.llm_top_k,
        top_p: config.llm_top_p,
        max_output_tokens: maxOutputTokens,
        stop_sequences: [],
      },
      safety_settings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    };
    const thinkingConfig = serializeGoogleThinkingConfig(buildGoogleThinkingConfig(modelName, config.thinking_level));
    if (thinkingConfig) out.thinking_config = thinkingConfig;
    if (disabledParams.length > 0) out.disabled_params = disabledParams;
    return out;
  }

  if (providerName === "anthropic") {
    // 3. Anthropic: uses selectAnthropicSamplingParams to coalesce temp+top_p
    const selection = selectAnthropicSamplingParams({
      temperature: config.llm_temperature,
      topP: config.llm_top_p,
      disabledParams,
    });
    const maxTokens = Number.parseInt(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS || "8192", 10);
    const stopSequences = buildProviderStopStrings({
      providerName: "anthropic",
      model: modelName,
      personaName: persona.tomori_nickname,
    });

    const thinkingRequest = buildAnthropicThinkingRequest(modelName, config.thinking_level);
    const out: Record<string, unknown> = { max_tokens: maxTokens };
    if (!thinkingRequest.omitSampling) {
      if (selection.temperature !== undefined) out.temperature = selection.temperature;
      if (selection.topP !== undefined) out.top_p = selection.topP;
      if (config.llm_top_k > 0 && !disabledParams.includes("topK")) out.top_k = config.llm_top_k;
    }
    if (thinkingRequest.thinking) out.thinking = thinkingRequest.thinking;
    if (thinkingRequest.output_config) out.output_config = thinkingRequest.output_config;
    if (stopSequences) out.stop_sequences = stopSequences;
    if (disabledParams.length > 0) out.disabled_params = disabledParams;
    return out;
  }

  // 4. OpenAI-compatible (openrouter, deepseek, zai, zaicoding, nvidia, custom, novelai):
  //    translate active sampling params to snake_case and include stop + max_tokens.
  const active = buildActiveSamplingParams(config);
  const maxTokensRaw = process.env.OPENROUTER_MAX_OUTPUT_TOKENS || "8192";
  const maxTokens = Number.parseInt(maxTokensRaw, 10);
  const stopStrings = buildProviderStopStrings({
    providerName,
    model: modelName,
    personaName: persona.tomori_nickname,
  });

  const out: Record<string, unknown> = { max_tokens: maxTokens };
  if (active.temperature !== undefined) out.temperature = active.temperature;
  if (active.topP !== undefined) out.top_p = active.topP;
  if (active.topK !== undefined) out.top_k = active.topK;
  if (active.frequencyPenalty !== undefined) out.frequency_penalty = active.frequencyPenalty;
  if (active.presencePenalty !== undefined) out.presence_penalty = active.presencePenalty;
  if (active.minP !== undefined) out.min_p = active.minP;
  if (stopStrings) out.stop = stopStrings;
  if (disabledParams.length > 0) out.disabled_params = disabledParams;

  if (providerName === "openrouter") {
    const reasoningRequest = buildOpenRouterReasoningRequest(config.thinking_level);
    if (reasoningRequest.reasoning) out.reasoning = reasoningRequest.reasoning;
  }

  if (providerName === "deepseek") {
    const thinkingRequest = buildDeepSeekThinkingRequest(modelName, config.thinking_level);
    if (thinkingRequest.thinking) out.thinking = thinkingRequest.thinking;
    if (thinkingRequest.omitSampling) {
      delete out.temperature;
      delete out.top_p;
      delete out.frequency_penalty;
      delete out.presence_penalty;
    }
  }

  if (providerName === "zai" || providerName === "zaicoding") {
    const thinkingRequest = buildZaiThinkingRequest(config.thinking_level);
    if (thinkingRequest.thinking) out.thinking = thinkingRequest.thinking;
    if (thinkingRequest.omitSampling) {
      delete out.temperature;
      delete out.top_p;
      delete out.frequency_penalty;
      delete out.presence_penalty;
    }
  }

  if (providerName === "custom") {
    const customThinking = buildCustomThinkingRequest(config.custom_endpoint_url, config.thinking_level);
    if (customThinking.reasoning_effort) {
      out.reasoning_effort = customThinking.reasoning_effort;
    }
  }

  if (providerName === "novelai") {
    out.thinking_directive = getNovelAiThinkingDirective(config.thinking_level);
  }

  // Acknowledge has_tools flag is mirrored from adapter runtime — informational
  if (!activeLlm.has_tools) out.tools_disabled = true;

  return out;
}
