import type {
  ChatInputCommandInteraction,
  Client,
  Guild,
  SlashCommandSubcommandBuilder,
  TextBasedChannel,
  Embed,
  Message,
} from "discord.js";
import { ChannelType, EmbedBuilder, MessageFlags, TextInputStyle } from "discord.js";
import { localizer, getSupportedLocales } from "@/utils/text/localizer";
import { ColorCode, log } from "@/utils/misc/logger";
import { replyInfoEmbed, promptWithRawModal } from "@/utils/discord/interactionHelper";
import type { UserRow } from "@/types/db/schema";
import { PrivacyLevel } from "@/types/db/schema";
import { loadTomoriState, loadAllPersonasForServer, loadPersonalMemoriesForUserLineage } from "@/utils/db/dbRead";
import { decryptApiKey } from "@/utils/security/crypto";
import { getCachedUserRow, getCachedPrivacyLevel, getCachedBlacklistStatus } from "@/utils/cache/userCache";
import { resolvePersonaAvatarURL } from "@/utils/discord/webhookManager";
import { resolvePersonaAvatarPublicUrl } from "@/utils/storage/avatarStorage";
import type { ModalComponent } from "@/types/discord/modal";
import { escapeRegExp } from "@/utils/text/stringHelper";
import type { CompactRoleplaySummary, CompactSummaryMode } from "@/types/misc/compact";
import { MAX_MESSAGE_FETCH_LIMIT } from "@/utils/discord/messageFetchLimit";
import {
  generateConversationSummaryForProvider,
  generateRoleplaySummaryForProvider,
} from "@/providers/utils/providerFeatureExecutors";
import { providerSupportsFeature } from "@/utils/provider/providerInfoRegistry";
import { getEffectiveLlmModelName } from "@/utils/provider/modelDisplay";

const MODAL_CUSTOM_ID = "tool_compact_modal";
const REFRESH_FIELD_ID = "refresh_context";
const ANALYZE_IMAGES_FIELD_ID = "analyze_images";
const SYSTEM_PROMPT_FIELD_ID = "system_prompt";

const DEFAULT_CONVERSATION_SYSTEM_PROMPT =
  "You are a skilled conversation analyst who creates clear, readable summaries of Discord conversations. " +
  "Your goal is to distill the conversation into a well-written, human-readable narrative that captures the essential elements: " +
  "key facts, relationships between participants, important decisions, ongoing tasks, and the overall flow of discussion. " +
  "Write in natural prose that's easy to understand, avoiding unnecessary jargon or robotic phrasing. " +
  "Be concise but thorough: every sentence should add value. Output plain text only.";

const DEFAULT_ROLEPLAY_SYSTEM_PROMPT =
  "You are a skilled storyteller who crafts clear, engaging summaries of roleplay scenes. " +
  "Analyze the roleplay narrative and produce a structured JSON summary that captures the scene and each character's current state. " +
  "Write with clarity and literary quality: your descriptions should paint a vivid picture while remaining concise. " +
  "Base every detail on what's actually present in the context; if something isn't shown, mark it as 'Unknown' or 'Not specified'. " +
  "Keep each field brief but evocative: think short phrases or 2-3 well-crafted sentences that tell the story.\n\n" +
  "The JSON structure should contain:\n" +
  "- overall_scene_summary: A narrative overview of the current scene, setting, atmosphere, and what's happening\n" +
  "- characters: An array where each character has:\n" +
  "  - name: The character's name\n" +
  "  - current_goals: What the character is trying to accomplish or their immediate intentions\n" +
  "  - emotional_status: The character's current feelings, mood, and emotional state\n" +
  "  - physical_status: The character's physical condition, location, pose, health, or any injuries/ailments\n" +
  "  - appearance_clothing: How the character currently looks and what they're wearing\n" +
  "  - inventory: Notable items the character has on them or is currently using";

/**
 * Configure /tool compact subcommand
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("compact")
    .setDescription(localizer("en-US", "commands.tool.compact.description"))
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription(localizer("en-US", "commands.tool.compact.type_description"))
        .addChoices(
          { name: localizer("en-US", "commands.tool.compact.modal.type_choice_conversation"), value: "conversation" },
          { name: localizer("en-US", "commands.tool.compact.modal.type_choice_roleplay"), value: "roleplay" },
        )
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(localizer("en-US", "commands.tool.compact.channel_description"))
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("thread")
        .setDescription(localizer("en-US", "commands.tool.compact.thread_description"))
        .setRequired(false),
    );

function truncateEmbedDescription(text: string, maxLength = 4000): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function buildEmojiCdnUrl(emojiId: string): string {
  return `https://cdn.discordapp.com/emojis/${emojiId}.png`;
}

function buildStickerCdnUrl(stickerId: string): string {
  return `https://cdn.discordapp.com/stickers/${stickerId}.png`;
}

type ImageReference = {
  label: string;
  url: string;
  mimeType?: string;
  source: string;
};

function extractCustomEmojiImages(content: string): Array<{ url: string; name: string }> {
  const results: Array<{ url: string; name: string }> = [];
  if (!content) return results;

  const emojiPattern = /<(a?):([^:]+):(\d{17,20})>/g;
  const seenEmojiIds = new Set<string>();
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: Iterative regex exec
  while ((match = emojiPattern.exec(content)) !== null) {
    const emojiName = match[2];
    const emojiId = match[3];
    if (seenEmojiIds.has(emojiId)) continue;
    seenEmojiIds.add(emojiId);
    results.push({
      url: buildEmojiCdnUrl(emojiId),
      name: emojiName,
    });
  }

  return results;
}

function matchesLocalizedTitleTemplate(template: string, actualTitle: string): boolean {
  if (!template.includes("{")) {
    return actualTitle === template;
  }

  const pattern = new RegExp(`^${escapeRegExp(template).replace(/\\\{[^}]+\\\}/g, ".+?")}$`);
  return pattern.test(actualTitle);
}

function classifyEmbedTitle(embedTitle: string | null): {
  isReset: boolean;
  isSystemInjection: boolean;
  isMemoryLearning: boolean;
  isReminderSet: boolean;
} {
  if (!embedTitle) {
    return {
      isReset: false,
      isSystemInjection: false,
      isMemoryLearning: false,
      isReminderSet: false,
    };
  }

  for (const supportedLocale of getSupportedLocales()) {
    const memoryLearningTitles = [
      localizer(supportedLocale, "genai.self_teach.server_memory_learned_title"),
      localizer(supportedLocale, "genai.self_teach.personal_memory_learned_title"),
      localizer(supportedLocale, "genai.self_teach.server_memory_updated_title"),
      localizer(supportedLocale, "genai.self_teach.personal_memory_updated_title"),
      localizer(supportedLocale, "genai.self_teach.server_memory_deleted_title"),
      localizer(supportedLocale, "genai.self_teach.personal_memory_deleted_title"),
    ];

    const reminderSetTitles = [
      localizer(supportedLocale, "reminders.reminder_set_title"),
      localizer(supportedLocale, "reminders.recurring_task_set_title"),
      localizer(supportedLocale, "reminders.task_set_title"),
    ];

    const systemInjectionTitle = localizer(supportedLocale, "commands.bot.impersonate.system_title");

    const refreshTitle = localizer(supportedLocale, "commands.tool.refresh.title");

    const compactSummaryTitle = localizer(supportedLocale, "commands.tool.compact.summary_title");
    const compactSummaryTitleRefreshed = localizer(supportedLocale, "commands.tool.compact.summary_title_refreshed");
    const compactSceneTitle = localizer(supportedLocale, "commands.tool.compact.roleplay_scene_title");
    const compactSceneTitleRefreshed = localizer(
      supportedLocale,
      "commands.tool.compact.roleplay_scene_title_refreshed",
    );
    const compactCharacterTitlePrefix = localizer(
      supportedLocale,
      "commands.tool.compact.roleplay_character_title_prefix",
    );

    const isMemoryLearning = memoryLearningTitles.some((title) => matchesLocalizedTitleTemplate(title, embedTitle));
    const isReminderSet = reminderSetTitles.some((title) => matchesLocalizedTitleTemplate(title, embedTitle));
    const isReset =
      embedTitle === refreshTitle ||
      embedTitle === compactSummaryTitleRefreshed ||
      embedTitle === compactSceneTitleRefreshed;

    const isSystemInjection =
      embedTitle === systemInjectionTitle ||
      embedTitle === compactSummaryTitle ||
      embedTitle === compactSummaryTitleRefreshed ||
      embedTitle === compactSceneTitle ||
      embedTitle === compactSceneTitleRefreshed ||
      Boolean(compactCharacterTitlePrefix && embedTitle.startsWith(compactCharacterTitlePrefix));

    if (isMemoryLearning || isReminderSet || isReset || isSystemInjection) {
      return {
        isReset,
        isSystemInjection,
        isMemoryLearning,
        isReminderSet,
      };
    }
  }

  return {
    isReset: false,
    isSystemInjection: false,
    isMemoryLearning: false,
    isReminderSet: false,
  };
}

function appendEmbedContent(baseContent: string, embed: Embed): string {
  if (!embed.description || !embed.title) return baseContent;

  const classification = classifyEmbedTitle(embed.title);
  if (!classification.isSystemInjection && !classification.isMemoryLearning && !classification.isReminderSet) {
    return baseContent;
  }

  const description = embed.description.trim();
  if (!description) return baseContent;

  if (classification.isSystemInjection) {
    const systemContent = `[System: ${description}]`;
    return baseContent ? `${baseContent}\n${systemContent}` : systemContent;
  }

  if (classification.isMemoryLearning) {
    const systemContent = `[System: ${embed.title}\n${description}]`;
    return baseContent ? `${baseContent}\n${systemContent}` : systemContent;
  }

  const embedContent = `[The following is a system-produced embed]\n${embed.title}\n${description}`;
  return baseContent ? `${baseContent}\n${embedContent}` : embedContent;
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeNameForMatch(value: string): string {
  return value
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

async function buildPersonaAvatarMap(serverDiscId: string, guild?: Guild | null): Promise<Map<string, string>> {
  const personas = await loadAllPersonasForServer(serverDiscId);
  const avatarMap = new Map<string, string>();

  for (const persona of personas) {
    let avatarUrl: string | undefined;
    if (guild) {
      avatarUrl = resolvePersonaAvatarURL(persona, guild);
    } else if (persona.webhook_avatar_url) {
      avatarUrl = resolvePersonaAvatarPublicUrl(persona.webhook_avatar_url) ?? undefined;
    }

    if (!avatarUrl) continue;
    const nameKey = persona.tomori_nickname?.trim().toLowerCase();
    if (!nameKey) continue;
    avatarMap.set(nameKey, avatarUrl);
  }

  return avatarMap;
}

async function buildUserAvatarMap(params: {
  userIds: string[];
  client: Client;
  guild?: Guild | null;
  serverDiscId: string;
}): Promise<Map<string, string>> {
  const avatarMap = new Map<string, string>();

  for (const userId of params.userIds) {
    let member = null;
    if (params.guild) {
      member = await params.guild.members.fetch(userId).catch(() => null);
    }

    const user = member?.user ?? (await params.client.users.fetch(userId).catch(() => null));
    if (!user) continue;

    const avatarUrl =
      member?.displayAvatarURL({
        extension: "png",
        size: 256,
        forceStatic: true,
      }) ??
      user.displayAvatarURL({
        extension: "png",
        size: 256,
        forceStatic: true,
      });

    if (!avatarUrl || !isValidHttpUrl(avatarUrl)) continue;

    const userRow = await getCachedUserRow(userId);
    const nameCandidates = [
      member?.displayName,
      member?.nickname,
      user.globalName,
      user.username,
      userRow?.user_nickname,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.trim().toLowerCase());

    for (const name of nameCandidates) {
      if (!avatarMap.has(name)) {
        avatarMap.set(name, avatarUrl);
      }
    }
  }

  return avatarMap;
}

async function buildConversationContext(params: {
  channel: TextBasedChannel;
  includeImages: boolean;
  maxMessages: number;
}): Promise<{
  conversationText: string;
  imageReferences: ImageReference[];
  userIds: string[];
}> {
  const fetchedMessages = await params.channel.messages.fetch({
    limit: params.maxMessages,
  });

  const messagesArray = Array.from(fetchedMessages.values()).reverse();

  let resetIndex = -1;
  for (let i = messagesArray.length - 1; i >= 0; i--) {
    const msg = messagesArray[i];
    const embedContainsReset = msg.embeds.some((embed) => {
      const classification = classifyEmbedTitle(embed.title ?? null);
      return classification.isReset;
    });

    if (embedContainsReset) {
      resetIndex = i;
      break;
    }
  }

  const startIndex = resetIndex === -1 ? 0 : resetIndex + 1;
  const relevantMessages = messagesArray.slice(startIndex);

  const conversationLines: string[] = [];
  const imageReferences: ImageReference[] = [];
  const userIdSet = new Set<string>();
  let imageCounter = 1;

  for (const msg of relevantMessages) {
    const authorId = msg.author.id;
    const authorPrivacyLevel = await getCachedPrivacyLevel(authorId);
    if (authorPrivacyLevel === PrivacyLevel.FULL) {
      continue;
    }

    userIdSet.add(authorId);

    const authorName = msg.member?.displayName || msg.author.username;
    let messageContent = msg.content?.trim() || "";

    if (msg.embeds.length > 0) {
      for (const embed of msg.embeds) {
        messageContent = appendEmbedContent(messageContent, embed);
      }
    }

    const messageImages: ImageReference[] = [];
    if (params.includeImages) {
      for (const attachment of msg.attachments.values()) {
        if (!attachment.contentType?.startsWith("image/")) continue;
        messageImages.push({
          label: `Image ${imageCounter++}`,
          url: attachment.url,
          mimeType: attachment.contentType ?? undefined,
          source: `${authorName} attachment${attachment.name ? ` (${attachment.name})` : ""}`,
        });
      }

      const emojiImages = extractCustomEmojiImages(msg.content || "");
      for (const emoji of emojiImages) {
        messageImages.push({
          label: `Image ${imageCounter++}`,
          url: emoji.url,
          mimeType: "image/png",
          source: `${authorName} emoji (${emoji.name})`,
        });
      }

      if (msg.stickers && msg.stickers.size > 0) {
        for (const sticker of msg.stickers.values()) {
          messageImages.push({
            label: `Image ${imageCounter++}`,
            url: buildStickerCdnUrl(sticker.id),
            mimeType: "image/png",
            source: `${authorName} sticker (${sticker.name})`,
          });
        }
      }
    }

    let line = messageContent || "(no text)";
    if (messageImages.length > 0) {
      const labels = messageImages.map((img) => img.label).join(", ");
      line = `${line} [${labels}]`;
      imageReferences.push(...messageImages);
    }

    conversationLines.push(`${authorName}: ${line}`);
  }

  const conversationText = conversationLines.join("\n");
  return {
    conversationText,
    imageReferences,
    userIds: Array.from(userIdSet),
  };
}

async function buildSupplementaryContext(params: {
  serverDiscId: string;
  userIds: string[];
  includePersonas: boolean;
}): Promise<string> {
  const sections: string[] = [];
  const tomoriState = await loadTomoriState(params.serverDiscId);

  if (tomoriState?.server_memories && tomoriState.server_memories.length > 0) {
    sections.push(`Server memories:\n- ${tomoriState.server_memories.join("\n- ")}`);
  }

  if (tomoriState) {
    const personalizationEnabled = tomoriState.config.personal_memories_enabled ?? true;

    const userMemoryLines: string[] = [];
    for (const userId of params.userIds) {
      const userPrivacyLevel = await getCachedPrivacyLevel(userId);
      if (userPrivacyLevel !== PrivacyLevel.MINIMAL) continue;

      const userRow = await getCachedUserRow(userId);
      if (!userRow?.user_id) {
        continue;
      }

      const isBlacklisted = await getCachedBlacklistStatus(params.serverDiscId, userId);
      if (isBlacklisted) continue;
      if (!personalizationEnabled) continue;

      const lineageId = tomoriState.persona_lineage_id ?? 0;
      const personalMemoryRows = await loadPersonalMemoriesForUserLineage(userRow.user_id, lineageId, true);
      if (personalMemoryRows.length === 0) {
        continue;
      }

      const userDisplayName = userRow.user_nickname || userId;
      const memoryList = personalMemoryRows.map((row) => row.content);
      userMemoryLines.push(`${userDisplayName}: ${memoryList.join("; ")}`);
    }

    if (userMemoryLines.length > 0) {
      sections.push(`User memories:\n- ${userMemoryLines.join("\n- ")}`);
    }
  }

  if (params.includePersonas) {
    const personas = await loadAllPersonasForServer(params.serverDiscId);
    if (personas.length > 0) {
      const personaLines = personas.map((persona) => {
        const attributes = persona.attribute_list?.length ? persona.attribute_list.join(" | ") : "(no attributes)";
        return `${persona.tomori_nickname}: ${attributes}`;
      });

      sections.push(`Personas:\n- ${personaLines.join("\n- ")}`);
    }
  }

  return sections.join("\n\n");
}

function buildConversationPrompt(params: {
  conversationText: string;
  imageReferences: ImageReference[];
  supplementaryContext: string;
  systemPrompt: string;
}): { systemPrompt: string; userPrompt: string } {
  const sections: string[] = [];
  sections.push("MAIN CONTEXT (chronological):");
  sections.push(params.conversationText || "(no recent messages)");

  if (params.imageReferences.length > 0) {
    sections.push("\nIMAGE REFERENCES:");
    sections.push(params.imageReferences.map((img) => `${img.label}: ${img.source}`).join("\n"));
  }

  if (params.supplementaryContext) {
    sections.push("\nSUPPLEMENTARY CONTEXT:");
    sections.push(params.supplementaryContext);
  }

  sections.push("\nPlease keep the summary under 3500 characters.");

  return {
    systemPrompt: params.systemPrompt,
    userPrompt: sections.join("\n"),
  };
}

function buildRoleplayPrompt(params: {
  conversationText: string;
  imageReferences: ImageReference[];
  supplementaryContext: string;
  systemPrompt: string;
}): { systemPrompt: string; userPrompt: string } {
  const sections: string[] = [];
  sections.push("MAIN CONTEXT (chronological):");
  sections.push(params.conversationText || "(no recent messages)");

  if (params.imageReferences.length > 0) {
    sections.push("\nIMAGE REFERENCES:");
    sections.push(params.imageReferences.map((img) => `${img.label}: ${img.source}`).join("\n"));
  }

  if (params.supplementaryContext) {
    sections.push("\nSUPPLEMENTARY CONTEXT:");
    sections.push(params.supplementaryContext);
  }

  return {
    systemPrompt: params.systemPrompt,
    userPrompt: sections.join("\n"),
  };
}

function buildRoleplayEmbeds(
  locale: string,
  summary: CompactRoleplaySummary,
  refresh: boolean,
  avatarMap?: Map<string, string>,
): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];

  const sceneTitle = refresh
    ? localizer(locale, "commands.tool.compact.roleplay_scene_title_refreshed")
    : localizer(locale, "commands.tool.compact.roleplay_scene_title");

  const synopsisHeader = localizer(locale, "commands.tool.compact.roleplay_scene_synopsis_header");
  const sceneDescription = `## ${synopsisHeader}\n${summary.overall_scene_summary}`;

  const sceneEmbed = new EmbedBuilder()
    .setTitle(sceneTitle)
    .setDescription(truncateEmbedDescription(sceneDescription))
    .setColor(ColorCode.SECTION);

  if (refresh) {
    sceneEmbed.setFooter({
      text: localizer(locale, "commands.tool.compact.refresh_footer"),
    });
  }

  embeds.push(sceneEmbed);

  const characterPrefix = localizer(locale, "commands.tool.compact.roleplay_character_title_prefix");
  const labelCurrentGoals = localizer(locale, "commands.tool.compact.roleplay_labels.current_goals");
  const labelEmotionalStatus = localizer(locale, "commands.tool.compact.roleplay_labels.emotional_status");
  const labelPhysicalStatus = localizer(locale, "commands.tool.compact.roleplay_labels.physical_status");
  const labelAppearance = localizer(locale, "commands.tool.compact.roleplay_labels.appearance_clothing");
  const labelInventory = localizer(locale, "commands.tool.compact.roleplay_labels.inventory");
  const fuzzyAvatarMap = new Map<string, string>();
  if (avatarMap) {
    for (const [nameKey, url] of avatarMap) {
      const normalized = normalizeNameForMatch(nameKey);
      if (!normalized || fuzzyAvatarMap.has(normalized)) continue;
      fuzzyAvatarMap.set(normalized, url);
    }
  }

  for (const character of summary.characters) {
    const lines = [
      `**${labelCurrentGoals} ${character.name || "Unknown"}**: ${character.current_goals || "Unknown"}`,
      `**${labelEmotionalStatus} ${character.name || "Unknown"}**: ${character.emotional_status || "Unknown"}`,
      `**${labelPhysicalStatus} ${character.name || "Unknown"}**: ${character.physical_status || "Unknown"}`,
      `**${labelAppearance} ${character.name || "Unknown"}**: ${character.appearance_clothing || "Unknown"}`,
      `**${labelInventory} ${character.name || "Unknown"}**: ${character.inventory || "Unknown"}`,
    ];

    const description = truncateEmbedDescription(lines.join("\n"));
    const embed = new EmbedBuilder()
      .setTitle(`${characterPrefix} ${character.name || "Unknown"}`)
      .setDescription(description)
      .setColor(ColorCode.SECTION);

    let avatarUrl = character.name ? avatarMap?.get(character.name.trim().toLowerCase()) : undefined;
    if (!avatarUrl && character.name) {
      const normalized = normalizeNameForMatch(character.name);
      avatarUrl = normalized ? fuzzyAvatarMap.get(normalized) : undefined;
    }
    if (!avatarUrl && character.name) {
      const normalized = normalizeNameForMatch(character.name);
      if (normalized && normalized.length >= 3) {
        let bestMatchKey = "";
        for (const [key, url] of fuzzyAvatarMap.entries()) {
          if (key.length < 3) continue;
          if (normalized.includes(key) || key.includes(normalized)) {
            if (key.length > bestMatchKey.length) {
              bestMatchKey = key;
              avatarUrl = url;
            }
          }
        }
      }
    }
    if (avatarUrl) {
      embed.setThumbnail(avatarUrl);
    }

    embeds.push(embed);
  }

  return embeds;
}

function buildConversationEmbed(locale: string, summaryText: string, refresh: boolean): EmbedBuilder {
  const title = refresh
    ? localizer(locale, "commands.tool.compact.summary_title_refreshed")
    : localizer(locale, "commands.tool.compact.summary_title");

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(truncateEmbedDescription(summaryText))
    .setColor(ColorCode.SECTION);

  if (refresh) {
    embed.setFooter({
      text: localizer(locale, "commands.tool.compact.refresh_footer"),
    });
  }

  return embed;
}

type SendableChannel = {
  send: (options: { embeds: EmbedBuilder[] }) => Promise<Message>;
};

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

function isDiscordThreadChannel(channel: unknown): boolean {
  if (!channel || typeof channel !== "object") {
    return false;
  }

  if ("isThread" in channel && typeof channel.isThread === "function") {
    return channel.isThread();
  }

  if (!("type" in channel)) {
    return false;
  }

  const channelType = Number((channel as { type: number }).type);
  return (
    channelType === ChannelType.PublicThread ||
    channelType === ChannelType.PrivateThread ||
    channelType === ChannelType.AnnouncementThread
  );
}

async function sendEmbedsInChunks(channel: SendableChannel, embeds: EmbedBuilder[]): Promise<void> {
  const chunkSize = 10;
  for (let i = 0; i < embeds.length; i += chunkSize) {
    const chunk = embeds.slice(i, i + chunkSize);
    await channel.send({ embeds: chunk });
  }
}

/**
 * Execute /tool compact command
 */
export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
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

  // Read the summary type from the slash command option
  const summaryType = interaction.options.getString("type", true) as CompactSummaryMode;

  // Read optional redirect channel — if provided, summary posts there instead of here
  const targetChannelOption = interaction.options.getChannel("channel");
  const targetThreadId = interaction.options.getString("thread")?.trim();

  if (targetChannelOption && targetThreadId) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.tool.compact.destination_conflict_title",
      descriptionKey: "commands.tool.compact.destination_conflict_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (targetThreadId && !DISCORD_SNOWFLAKE_PATTERN.test(targetThreadId)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.tool.compact.thread_invalid_title",
      descriptionKey: "commands.tool.compact.thread_invalid_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const defaultSystemPrompt =
    summaryType === "roleplay" ? DEFAULT_ROLEPLAY_SYSTEM_PROMPT : DEFAULT_CONVERSATION_SYSTEM_PROMPT;

  const modalComponents: ModalComponent[] = [
    {
      // Checkbox Group with 1 option — checked = yes, unchecked = no.
      // min_values: 0 + required: false allows unchecked submission (the "no" path).
      // Result comes back in modalResult.multiValues[REFRESH_FIELD_ID] as string[].
      kind: "checkboxGroup" as const,
      customId: REFRESH_FIELD_ID,
      labelKey: "commands.tool.compact.modal.refresh_label",
      descriptionKey: "commands.tool.compact.modal.refresh_description",
      minValues: 0,
      required: false,
      options: [
        {
          label: localizer(locale, "general.yes"),
          value: "yes",
        },
      ],
    },
    {
      // Checkbox Group with 1 option — checked = yes, unchecked = no.
      // min_values: 0 + required: false allows unchecked submission (the "no" path).
      // Result comes back in modalResult.multiValues[ANALYZE_IMAGES_FIELD_ID] as string[].
      kind: "checkboxGroup" as const,
      customId: ANALYZE_IMAGES_FIELD_ID,
      labelKey: "commands.tool.compact.modal.analyze_images_label",
      descriptionKey: "commands.tool.compact.modal.analyze_images_description",
      minValues: 0,
      required: false,
      options: [
        {
          label: localizer(locale, "general.yes"),
          value: "yes",
        },
      ],
    },
    {
      customId: SYSTEM_PROMPT_FIELD_ID,
      labelKey: "commands.tool.compact.modal.system_prompt_label",
      placeholder: "commands.tool.compact.modal.system_prompt_placeholder",
      required: false,
      style: TextInputStyle.Paragraph,
      maxLength: 2000,
      value: defaultSystemPrompt,
    },
  ];

  const modalResult = await promptWithRawModal(
    interaction,
    locale,
    {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.tool.compact.modal.title",
      components: modalComponents,
    },
    MessageFlags.Ephemeral,
  );

  if (modalResult.outcome !== "submit") {
    return;
  }

  const submitInteraction = modalResult.interaction;
  if (!submitInteraction || !modalResult.values) {
    log.error("Compact modal submission missing values");
    return;
  }

  // Checkbox Group returns selected values in multiValues; "yes" present = true
  const refresh = (modalResult.multiValues?.[REFRESH_FIELD_ID] ?? []).includes("yes");
  const analyzeImages = (modalResult.multiValues?.[ANALYZE_IMAGES_FIELD_ID] ?? []).includes("yes");
  const systemPrompt =
    modalResult.values[SYSTEM_PROMPT_FIELD_ID]?.trim() ||
    (summaryType === "roleplay" ? DEFAULT_ROLEPLAY_SYSTEM_PROMPT : DEFAULT_CONVERSATION_SYSTEM_PROMPT);

  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  const tomoriState = await loadTomoriState(serverDiscId);
  if (!tomoriState) {
    await submitInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "general.errors.tomori_not_setup_title"))
          .setDescription(localizer(locale, "general.errors.tomori_not_setup_description"))
          .setColor(ColorCode.ERROR),
      ],
    });
    return;
  }

  const providerName = tomoriState.llm.llm_provider.toLowerCase();
  const effectiveModelName = getEffectiveLlmModelName(tomoriState.llm, tomoriState.config.custom_model_name);
  if (!providerSupportsFeature(providerName, "conversationCompaction")) {
    await submitInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.tool.compact.provider_unsupported_title"))
          .setDescription(
            localizer(locale, "commands.tool.compact.provider_unsupported_description", {
              provider: tomoriState.llm.llm_provider,
            }),
          )
          .setColor(ColorCode.ERROR),
      ],
    });
    return;
  }

  if (summaryType === "roleplay" && !tomoriState.llm.supports_structoutput) {
    await submitInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.tool.compact.model_incompatible_title"))
          .setDescription(
            localizer(locale, "commands.tool.compact.model_incompatible_description", {
              model_name: effectiveModelName,
            }),
          )
          .setColor(ColorCode.ERROR),
      ],
    });
    return;
  }

  if (analyzeImages && !tomoriState.llm.sees_images) {
    await submitInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.tool.compact.image_vision_required_title"))
          .setDescription(
            localizer(locale, "commands.tool.compact.image_vision_required_description", {
              model_name: effectiveModelName,
            }),
          )
          .setColor(ColorCode.ERROR),
      ],
    });
    return;
  }

  if (!tomoriState.config.api_key) {
    await submitInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "general.errors.api_key_missing_title"))
          .setDescription(localizer(locale, "general.errors.api_key_missing_description"))
          .setColor(ColorCode.ERROR),
      ],
    });
    return;
  }

  const keyVersion = tomoriState.config.key_version || 1;
  const apiKey = await decryptApiKey(tomoriState.config.api_key, keyVersion);
  if (!apiKey) {
    await submitInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "general.errors.api_key_error_title"))
          .setDescription(localizer(locale, "general.errors.api_key_error_description"))
          .setColor(ColorCode.ERROR),
      ],
    });
    return;
  }

  await submitInteraction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(localizer(locale, "commands.tool.compact.processing_title"))
        .setDescription(localizer(locale, "commands.tool.compact.processing_description"))
        .setColor(ColorCode.INFO),
    ],
  });

  const channel = submitInteraction.channel ?? interaction.channel;
  if (!channel || !("send" in channel) || typeof channel.send !== "function" || !("messages" in channel)) {
    await submitInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "general.errors.channel_only_title"))
          .setDescription(localizer(locale, "general.errors.channel_only_description"))
          .setColor(ColorCode.ERROR),
      ],
    });
    return;
  }

  const textChannel = channel as TextBasedChannel;

  // 1. Resolve the output channel: fetch the redirect target if specified, otherwise use the current channel
  let outputChannel: SendableChannel = channel as SendableChannel;
  if (targetChannelOption) {
    const fetchedTarget = await client.channels.fetch(targetChannelOption.id).catch(() => null);
    if (!fetchedTarget || !("send" in fetchedTarget)) {
      await submitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "general.errors.channel_only_title"))
            .setDescription(localizer(locale, "general.errors.channel_only_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }
    outputChannel = fetchedTarget as SendableChannel;
  }
  if (targetThreadId) {
    const fetchedTarget = await client.channels.fetch(targetThreadId).catch(() => null);
    if (
      !fetchedTarget ||
      !isDiscordThreadChannel(fetchedTarget) ||
      !("guildId" in fetchedTarget) ||
      fetchedTarget.guildId !== interaction.guildId ||
      !("send" in fetchedTarget) ||
      typeof fetchedTarget.send !== "function"
    ) {
      await submitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.tool.compact.thread_invalid_title"))
            .setDescription(localizer(locale, "commands.tool.compact.thread_invalid_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    outputChannel = fetchedTarget as SendableChannel;
  }

  // 2. Always build conversation context from the current channel (where the command was run)
  const { conversationText, imageReferences, userIds } = await buildConversationContext({
    channel: textChannel,
    includeImages: analyzeImages,
    maxMessages: MAX_MESSAGE_FETCH_LIMIT,
  });

  const supplementaryContext = await buildSupplementaryContext({
    serverDiscId,
    userIds,
    includePersonas: true,
  });

  const imagePayload = analyzeImages ? imageReferences.map((img) => ({ url: img.url, mimeType: img.mimeType })) : [];

  try {
    if (summaryType === "conversation") {
      const prompt = buildConversationPrompt({
        conversationText,
        imageReferences,
        supplementaryContext,
        systemPrompt,
      });

      log.info(`[Compact] Conversation system prompt:\n${prompt.systemPrompt}`);
      log.info(`[Compact] Conversation user prompt:\n${prompt.userPrompt}`);

      const result = await generateConversationSummaryForProvider({
        providerName,
        apiKey,
        model: effectiveModelName,
        endpointUrl: tomoriState.config.custom_endpoint_url ?? undefined,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        images: analyzeImages ? imagePayload : undefined,
      });

      if (result.error || !result.summary) {
        await submitInteraction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.tool.compact.failed_title"))
              .setDescription(
                localizer(locale, "commands.tool.compact.failed_description", {
                  error: result.error || "Unknown error",
                }),
              )
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      const summaryEmbed = buildConversationEmbed(locale, result.summary, refresh);

      await sendEmbedsInChunks(outputChannel, [summaryEmbed]);
    } else {
      const prompt = buildRoleplayPrompt({
        conversationText,
        imageReferences,
        supplementaryContext,
        systemPrompt,
      });

      log.info(`[Compact] Roleplay system prompt:\n${prompt.systemPrompt}`);
      log.info(`[Compact] Roleplay user prompt:\n${prompt.userPrompt}`);

      const userAvatarMap = await buildUserAvatarMap({
        userIds,
        client,
        guild: interaction.guild ?? null,
        serverDiscId,
      });
      const personaAvatarMap = await buildPersonaAvatarMap(serverDiscId, interaction.guild ?? null);
      const avatarMap = new Map(userAvatarMap);
      for (const [key, value] of personaAvatarMap) {
        avatarMap.set(key, value);
      }

      const result = await generateRoleplaySummaryForProvider({
        providerName,
        apiKey,
        model: effectiveModelName,
        endpointUrl: tomoriState.config.custom_endpoint_url ?? undefined,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        images: analyzeImages ? imagePayload : undefined,
      });

      if (result.error || !result.summary) {
        await submitInteraction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.tool.compact.failed_title"))
              .setDescription(
                localizer(locale, "commands.tool.compact.failed_description", {
                  error: result.error || "Unknown error",
                }),
              )
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      const embeds = buildRoleplayEmbeds(locale, result.summary, refresh, avatarMap);
      await sendEmbedsInChunks(outputChannel, embeds);
    }

    // Show success — if summary was redirected, tell the user which channel it went to
    const targetDestinationId = targetChannelOption?.id ?? targetThreadId;
    const successDescription = targetDestinationId
      ? localizer(locale, "commands.tool.compact.success_description_redirect", {
          channel: `<#${targetDestinationId}>`,
        })
      : localizer(locale, "commands.tool.compact.success_description");

    await submitInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.tool.compact.success_title"))
          .setDescription(successDescription)
          .setColor(ColorCode.SUCCESS),
      ],
    });
  } catch (error) {
    log.error("Compact summary command failed", error as Error);
    await submitInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.tool.compact.failed_title"))
          .setDescription(
            localizer(locale, "commands.tool.compact.failed_description", {
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          )
          .setColor(ColorCode.ERROR),
      ],
    });
  }
}
