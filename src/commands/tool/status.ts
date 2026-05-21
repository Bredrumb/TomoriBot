import type { SlashCommandSubcommandBuilder } from "discord.js";
import {
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type Client,
  MessageFlags,
  TextChannel,
} from "discord.js";
import {
  replyInfoEmbed,
  replyPaginatedStatusPages,
  replyPaginatedPersonaChoicesV2,
} from "../../utils/discord/interactionHelper";
import { ColorCode, log } from "../../utils/misc/logger";
import { localizer } from "../../utils/text/localizer";
import { getCachedTomoriState } from "../../utils/cache/tomoriStateCache";
import {
  getUserReminderCount,
  getBlacklistedMemberIds,
  loadPersonalMemoriesForUserLineage,
  loadAllPersonasForServer,
  getServerRandomTriggers,
  getAllChannelLlmOverridesForServer,
  loadEmbeddingModelById,
  loadSavedProviderConfigs,
  loadCustomEndpointsForServer,
  loadCustomEndpointsForUser,
  loadUserSavedProviderConfigs,
} from "../../utils/db/dbRead";
import { getDiffusionModelById } from "@/utils/image/naiDiffusionModels";
import { sql } from "@/utils/db/client";
import { getAllWhitelistChannels } from "../../utils/db/channelWhitelist";
import { getAllWhitelistPersonas } from "@/utils/db/personaWhitelist";
import { getAllWhitelistRoles } from "@/utils/db/roleWhitelist";
import { getQuotaConfig } from "@/utils/quota/imageQuotaManager";
import { getTextQuotaConfig } from "@/utils/quota/textQuotaManager";
import { getVideoQuotaConfig } from "@/utils/quota/videoQuotaManager";
import {
  resolveActiveTranscriptionEndpoint,
  resolveActiveSpeechEndpoint,
} from "@/utils/provider/speechEndpointResolver";
import type {
  UserRow,
  ChannelWhitelistRow,
  ChannelPersonaWhitelistRow,
  RoleWhitelistRow,
  RandomTriggerRow,
  LlmRow,
  TomoriConfigRow,
  GuildMcpServerRow,
  SavedProviderConfigRow,
  StPresetNodeRow,
  StPresetRow,
  FallbackEntry,
  CustomEndpointRow,
  UserSavedProviderConfigRow,
} from "../../types/db/schema";
import type { SummaryEmbedOptions } from "../../types/discord/embed";
import { CooldownType, PrivacyLevel, type TomoriState } from "../../types/db/schema";
import { formatBooleanLocalized } from "@/utils/text/stringHelper";
import { getMemoryLimits } from "@/utils/db/memoryLimits";
import { DEFAULT_SYSTEM_PROMPT } from "@/utils/text/contextBuilder";
import { formatLlmDisplayLabel } from "@/utils/provider/modelDisplay";
import { SUPPORTED_PARAM_STATUS_FIELD_KEYS, SUPPORTED_PARAM_VALUES } from "@/constants/supportedParams";
import { TOOL_NOTICE_DEFINITIONS } from "@/constants/toolNotices";
import { isNoticeEmbedVisible } from "@/utils/discord/toolProgressNotice";
import { loadGuildMcpServers } from "@/utils/db/guildMcpDb";
import { loadPresetsForServer, loadToggleableNodes } from "@/utils/db/stPresetDb";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { getThinkingLevelLocalizerKey } from "@/utils/provider/thinkingControl";
import { resolveDeliberateToolContextTurns } from "@/utils/tools/deliberateToolMode";
import { commandRegistry } from "@/utils/discord/commandRegistry";

// Constants
const MAX_ITEMS_DISPLAY = 5; // Max channel/member items before switching to count-only
const MEMORY_TRUNCATE_LENGTH = 100; // Max chars per memory snippet
const ATTRIBUTE_TRUNCATE_LENGTH = 200; // Max chars per attribute snippet
const DIALOGUE_TRUNCATE_LENGTH = 140; // Max chars per sample dialogue side
const STATUS_BULLET_TRUNCATE_LENGTH = 48; // Max chars per privacy-safe summary entry
const MAX_PROMPT_PREVIEW = Number.parseInt(process.env.SYSPROMPT_SHOW_MAX_PREVIEW || "3800", 10); // Max chars shown for system/persona prompts

interface OptApiKeyStatusRow {
  service_name: string;
}

interface MatrixLinkStatusRow {
  channel_disc_id: string;
}

/**
 * Returns a user-friendly label for a privacy level.
 * @param locale - User locale
 * @param level - Privacy level value
 * @returns Localized privacy label
 */
function getPrivacyLevelLabel(locale: string, level: PrivacyLevel): string {
  switch (level) {
    case PrivacyLevel.MINIMAL:
      return localizer(locale, "commands.personal.privacy.choice_minimal");
    case PrivacyLevel.PARTIAL:
      return localizer(locale, "commands.personal.privacy.choice_partial");
    case PrivacyLevel.FULL:
      return localizer(locale, "commands.personal.privacy.choice_full");
    default:
      return localizer(locale, "commands.personal.privacy.choice_minimal");
  }
}

/**
 * Returns a localized label for a CooldownType value.
 * Reuses the choice labels defined in commands.server.cooldown.
 * @param locale - User locale
 * @param type - CooldownType enum value
 * @returns Localized cooldown type label
 */
function getCooldownTypeLabel(locale: string, type: CooldownType): string {
  switch (type) {
    case CooldownType.OFF:
      return localizer(locale, "commands.server.cooldown.triggers.type.choice_off");
    case CooldownType.PER_USER:
      return localizer(locale, "commands.server.cooldown.triggers.type.choice_per_user");
    case CooldownType.PER_CHANNEL:
      return localizer(locale, "commands.server.cooldown.triggers.type.choice_per_channel");
    case CooldownType.SERVER_WIDE:
      return localizer(locale, "commands.server.cooldown.triggers.type.choice_server_wide");
    case CooldownType.STRICT_SERVER_WIDE:
      return localizer(locale, "commands.server.cooldown.triggers.type.choice_strict_server_wide");
    default:
      return localizer(locale, "commands.server.cooldown.triggers.type.choice_off");
  }
}

function getThinkingLevelLabel(locale: string, value: string | null | undefined): string {
  return localizer(locale, getThinkingLevelLocalizerKey(value));
}

function truncateText(input: string, maxLength: number): string {
  return input.length > maxLength ? `${input.substring(0, maxLength)}...` : input;
}

/**
 * Loads the codename and provider of a video generation model by ID.
 * @param videoModelId - The video model ID to look up
 * @returns An object with codename and provider, or null if not found
 */
async function loadVideoModelById(videoModelId: number): Promise<{ codename: string; provider: string } | null> {
  const [row] = await sql<{ codename: string; provider: string }[]>`
    SELECT codename, provider FROM video_generation_models WHERE video_model_id = ${videoModelId} LIMIT 1
  `;
  return row ?? null;
}

function formatQuotaLimitValue(locale: string, limit: number): string {
  return limit === 0 ? localizer(locale, "commands.tool.status.field_quota_unlimited") : String(limit);
}

function formatOmittedSamplingParams(
  disabledParams: TomoriConfigRow["llm_disabled_params"] | null | undefined,
  locale: string,
): string {
  const omittedParams = SUPPORTED_PARAM_VALUES.filter((param) => disabledParams?.includes(param));
  if (omittedParams.length === 0) {
    return localizer(locale, "commands.choices.none");
  }

  return omittedParams.map((param) => `\`${localizer(locale, SUPPORTED_PARAM_STATUS_FIELD_KEYS[param])}\``).join(", ");
}

/**
 * Formats an array of strings as a numbered list, truncating each item.
 * All items are included (nothing omitted).
 * @param items - Array of strings to format
 * @param locale - User locale
 * @param truncateLength - Max chars per item before truncation
 * @returns Formatted numbered list, or localized "None" if empty
 */
function formatNumberedList(items: string[], locale: string, truncateLength: number): string {
  if (items.length === 0) {
    return localizer(locale, "commands.choices.none");
  }
  return items
    .map((item, index) => {
      return `${index + 1}. ${truncateText(item, truncateLength)}`;
    })
    .join("\n");
}

/**
 * Formats an array of strings as a bullet list, truncating each item.
 * All items are included (nothing omitted).
 * @param items - Array of strings to format
 * @param locale - User locale
 * @param truncateLength - Max chars per item before truncation
 * @returns Formatted bullet list, or localized "None" if empty
 */
function formatBulletList(items: string[], locale: string, truncateLength: number): string {
  if (items.length === 0) {
    return localizer(locale, "commands.choices.none");
  }
  return items
    .map((item) => {
      return `• ${truncateText(item, truncateLength)}`;
    })
    .join("\n");
}

/**
 * Formats sample dialogue pairs as a numbered list with truncation on each side.
 * @param dialoguesIn - User/input dialogue examples
 * @param dialoguesOut - Persona/output dialogue examples
 * @param locale - User locale
 * @param truncateLength - Max chars per dialogue side before truncation
 * @returns Formatted list, or localized "None" if empty
 */
function formatSampleDialogues(
  dialoguesIn: string[],
  dialoguesOut: string[],
  locale: string,
  truncateLength: number,
): string {
  const pairCount = Math.max(dialoguesIn.length, dialoguesOut.length);
  if (pairCount === 0) {
    return localizer(locale, "commands.choices.none");
  }

  return Array.from({ length: pairCount }, (_, index) => {
    const input = truncateText(dialoguesIn[index] ?? localizer(locale, "commands.choices.none"), truncateLength);
    const output = truncateText(dialoguesOut[index] ?? localizer(locale, "commands.choices.none"), truncateLength);
    return `${index + 1}. ${input} -> ${output}`;
  }).join("\n");
}

/**
 * Resolves a Discord channel ID to a channel mention string.
 * Falls back to a raw snowflake mention if the fetch fails.
 * @param client - Discord client for channel fetch
 * @param id - Discord channel snowflake ID
 * @param locale - User locale (for unknown channel label)
 * @returns Resolved channel mention string
 */
async function resolveChannelMention(client: Client, id: string, locale: string): Promise<string> {
  try {
    const channel = await client.channels.fetch(id);
    return channel instanceof TextChannel ? channel.toString() : `<#${id}>`;
  } catch {
    return `*<${localizer(locale, "commands.tool.status.unknown_channel")} ${id}>*`;
  }
}

/**
 * Formats a list of channel IDs as mentions, collapsing to a count if over the max.
 * @param client - Discord client
 * @param ids - Array of channel Discord IDs
 * @param locale - User locale
 * @returns Formatted channel list string, or localized "None" if empty
 */
async function formatChannelList(client: Client, ids: string[], locale: string): Promise<string> {
  if (ids.length === 0) {
    return localizer(locale, "commands.choices.none");
  }
  const mentions = await Promise.all(ids.map((id) => resolveChannelMention(client, id, locale)));
  return mentions.length <= MAX_ITEMS_DISPLAY
    ? mentions.join(", ")
    : localizer(locale, "commands.tool.status.item_count", {
        count: mentions.length,
      });
}

/**
 * Formats the channel whitelist as a numbered list.
 * Shows each whitelisted channel with its per-channel cooldown type and duration.
 * When no entries exist, shows an "all channels allowed" message instead.
 * @param client - Discord client for channel mentions
 * @param entries - Array of whitelist rows from the database
 * @param locale - User locale
 * @returns Formatted whitelist string
 */
async function formatWhitelistEntries(client: Client, entries: ChannelWhitelistRow[], locale: string): Promise<string> {
  // 1. No entries = whitelist is inactive (all channels can trigger)
  if (entries.length === 0) {
    return localizer(locale, "commands.tool.status.whitelist_all_allowed");
  }

  // 2. Resolve each channel mention and build formatted lines
  const lines = await Promise.all(
    entries.map(async (entry, index) => {
      const mention = await resolveChannelMention(client, entry.channel_disc_id, locale);
      if (entry.cooldown_type === null || entry.cooldown_length === null) {
        return `${index + 1}. ${mention} (${localizer(locale, "commands.choices.inherit_global")})`;
      }

      const cooldownType = entry.cooldown_type;
      const typeLabel = getCooldownTypeLabel(locale, cooldownType);

      // 3. Include duration only when a real cooldown is set
      const detail = cooldownType === CooldownType.OFF ? typeLabel : `${typeLabel}, ${entry.cooldown_length}s`;

      return `${index + 1}. ${mention} (${detail})`;
    }),
  );

  return lines.join("\n");
}

/**
 * Formats the role whitelist as a numbered list.
 * When no entries exist, shows an "all roles allowed" message instead.
 * @param entries - Array of role whitelist rows from the database
 * @param locale - User locale
 * @returns Formatted role whitelist string
 */
function formatWhitelistRolesEntries(entries: RoleWhitelistRow[], locale: string): string {
  if (entries.length === 0) {
    return localizer(locale, "commands.tool.status.whitelist_roles_all_allowed");
  }

  return entries
    .map((entry, index) => {
      return `${index + 1}. <@&${entry.role_disc_id}>`;
    })
    .join("\n");
}

async function formatWhitelistPersonaEntries(
  client: Client,
  entries: ChannelPersonaWhitelistRow[],
  personaNameMap: Map<number, string>,
  locale: string,
): Promise<string> {
  if (entries.length === 0) {
    return localizer(locale, "commands.tool.status.whitelist_personas_all_allowed");
  }

  const channelsByPersona = new Map<number, string[]>();
  for (const entry of entries) {
    const channelIds = channelsByPersona.get(entry.tomori_id) ?? [];
    channelIds.push(entry.channel_disc_id);
    channelsByPersona.set(entry.tomori_id, channelIds);
  }

  const lines = await Promise.all(
    Array.from(channelsByPersona.entries()).map(async ([tomoriId, channelIds], index) => {
      const personaName = personaNameMap.get(tomoriId) ?? `ID:${tomoriId}`;
      const sortedChannelIds = [...new Set(channelIds)].sort((left, right) => left.localeCompare(right));
      const channelsValue =
        sortedChannelIds.length <= MAX_ITEMS_DISPLAY
          ? (
              await Promise.all(sortedChannelIds.map((channelId) => resolveChannelMention(client, channelId, locale)))
            ).join(", ")
          : localizer(locale, "commands.tool.status.item_count", {
              count: sortedChannelIds.length,
            });
      return `${index + 1}. **${personaName}**: ${channelsValue}`;
    }),
  );

  return lines.join("\n");
}

/**
 * Formats the list of random triggers as a numbered list.
 * Each entry shows channel, persona name, timer interval, and trigger probability.
 * @param client - Discord client for channel mentions
 * @param triggers - Array of random trigger rows from the database
 * @param personaNameMap - Map of tomori_id to persona nickname for name resolution
 * @param locale - User locale
 * @returns Formatted random trigger list string, or localized "None" if empty
 */
async function formatRandomTriggers(
  client: Client,
  triggers: RandomTriggerRow[],
  personaNameMap: Map<number, string>,
  locale: string,
): Promise<string> {
  if (triggers.length === 0) {
    return localizer(locale, "commands.choices.none");
  }

  const lines = await Promise.all(
    triggers.map(async (trigger, index) => {
      // 1. Resolve the channel mention
      const mention = await resolveChannelMention(client, trigger.channel_disc_id, locale);

      // 2. Resolve persona name (null tomori_id = random persona selection)
      const personaName =
        trigger.tomori_id != null
          ? (personaNameMap.get(trigger.tomori_id) ?? `ID:${trigger.tomori_id}`)
          : localizer(locale, "commands.tool.status.random_trigger_persona_random");
      const offsetSegment =
        trigger.random_offset_range != null && trigger.random_offset_range > 0
          ? ` · ${localizer(locale, "commands.tool.status.random_trigger_offset_segment", {
              hours: trigger.random_offset_range,
            })}`
          : "";
      const silenceSegment =
        trigger.silence_threshold_hours != null && trigger.silence_threshold_hours > 0
          ? ` · ${localizer(locale, "commands.tool.status.random_trigger_silence_segment", {
              hours: trigger.silence_threshold_hours,
            })}`
          : "";
      const respondToSelfSegment = trigger.respond_to_self
        ? ` · ${localizer(locale, "commands.tool.status.random_trigger_self_segment")}`
        : "";
      const promptSegment = trigger.custom_prompt?.trim()
        ? ` · ${localizer(locale, "commands.tool.status.random_trigger_prompt_segment")}`
        : "";
      const failureSegment =
        trigger.failure_threshold != null && trigger.failure_threshold > 0
          ? ` · ${localizer(locale, "commands.tool.status.random_trigger_failure_segment", {
              count: trigger.failure_threshold,
            })}`
          : "";

      // 3. Format: "N. #channel · Persona · Xh · Y% · extra..."
      return truncateText(
        `${index + 1}. ${mention} · ${personaName} · ${localizer(
          locale,
          "commands.tool.status.random_trigger_timer_segment",
          {
            hours: trigger.timer_hours,
          },
        )}${offsetSegment} · ${localizer(locale, "commands.tool.status.random_trigger_chance_segment", {
          chance: trigger.chance_percent,
        })}${silenceSegment}${respondToSelfSegment}${promptSegment}${failureSegment}`,
        220,
      );
    }),
  );

  return lines.join("\n");
}

async function formatAutochatChannels(
  client: Client,
  config: TomoriConfigRow,
  personaNameMap: Map<number, string>,
  mainPersonaName: string,
  locale: string,
): Promise<string> {
  const channelIds = config.autoch_disc_ids ?? [];
  if (channelIds.length === 0) {
    return localizer(locale, "commands.choices.none");
  }

  if (channelIds.length > MAX_ITEMS_DISPLAY) {
    return localizer(locale, "commands.tool.status.item_count", {
      count: channelIds.length,
    });
  }

  const overrideMap = new Map(
    (config.autoch_persona_overrides ?? []).map((override) => [override.channel_disc_id, override.tomori_id]),
  );

  const lines = await Promise.all(
    channelIds.map(async (channelId, index) => {
      const mention = await resolveChannelMention(client, channelId, locale);
      const personaId = overrideMap.get(channelId);
      const personaName = personaId != null ? (personaNameMap.get(personaId) ?? `ID:${personaId}`) : mainPersonaName;
      return `${index + 1}. ${mention} · ${personaName}`;
    }),
  );

  return lines.join("\n");
}

/**
 * Formats the list of channel-level LLM overrides as a numbered list.
 * Each entry shows channel mention and the model codename + provider.
 * @param client - Discord client for channel mentions
 * @param overrides - Array of channel override objects from the database
 * @param locale - User locale
 * @returns Formatted channel LLM override list string, or localized "None" if empty
 */
async function formatChannelLlmOverrides(
  client: Client,
  overrides: { channelDiscId: string; llm: LlmRow }[],
  locale: string,
  customModelName?: string | null,
  otherModelCodename?: string | null,
): Promise<string> {
  if (overrides.length === 0) {
    return localizer(locale, "commands.choices.none");
  }

  const lines = await Promise.all(
    overrides.map(async (entry, index) => {
      // 1. Resolve channel mention
      const mention = await resolveChannelMention(client, entry.channelDiscId, locale);
      // 2. Format: "N. #channel → model (provider)"
      return `${index + 1}. ${mention} → ${formatLlmDisplayLabel(entry.llm, customModelName, otherModelCodename)}`;
    }),
  );

  return lines.join("\n");
}

/**
 * Formats the list of persona-level LLM overrides as a numbered list.
 * Only includes personas that have an explicit model override set.
 * @param personas - Array of all TomoriState personas for the server
 * @param locale - User locale
 * @returns Formatted persona LLM override list string, or localized "None" if empty
 */
function formatPersonaLlmOverrides(
  personas: TomoriState[],
  locale: string,
  customModelName?: string | null,
  otherModelCodename?: string | null,
): string {
  // 1. Filter to personas with an explicit override, narrowing the type so llm is non-optional
  const overrides = personas.filter((p): p is TomoriState & { persona_llm: LlmRow } => p.persona_llm != null);

  if (overrides.length === 0) {
    return localizer(locale, "commands.choices.none");
  }

  // 2. Format: "N. Persona Name → `model` (provider)"
  return overrides
    .map((p, index) => {
      return `${index + 1}. **${p.tomori_nickname}** → ${formatLlmDisplayLabel(p.persona_llm, customModelName, otherModelCodename)}`;
    })
    .join("\n");
}

/**
 * Formats welcome channel configuration as a single-line string.
 * Shows channel mention with associated persona if configured.
 * When no welcome channel is set, shows a localized "None" message.
 * @param client - Discord client for channel mentions
 * @param config - TomoriState config containing welcome_channel_disc_id and welcome_persona_id
 * @param personaNameMap - Map of persona IDs to nicknames
 * @param locale - User locale
 * @returns Formatted welcome channel string
 */
async function formatWelcomeChannel(
  client: Client,
  config: TomoriConfigRow,
  personaNameMap: Map<number, string>,
  locale: string,
): Promise<string> {
  const welcomeChannelId = config.welcome_channel_disc_id;

  if (!welcomeChannelId) {
    return localizer(locale, "commands.choices.none");
  }

  // 1. Resolve channel mention
  const channelMention = await resolveChannelMention(client, welcomeChannelId, locale);

  // 2. Resolve persona name (null welcome_persona_id = random persona selection)
  const personaName =
    config.welcome_persona_id != null
      ? (personaNameMap.get(config.welcome_persona_id) ?? `ID:${config.welcome_persona_id}`)
      : localizer(locale, "commands.tool.status.random_trigger_persona_random");

  // 3. Format: "#channel · Persona"
  return `${channelMention} · ${personaName}`;
}

function formatConfiguredEntryNames(items: string[], locale: string): string {
  if (items.length === 0) {
    return localizer(locale, "commands.choices.none");
  }

  return formatBulletList(items, locale, STATUS_BULLET_TRUNCATE_LENGTH);
}

function getOptionalApiServiceDisplayName(serviceName: string, locale: string): string {
  switch (serviceName) {
    case "brave-search":
      return localizer(locale, "commands.tool.status.optional_api_service_brave");
    case "google":
      return localizer(locale, "commands.tool.status.optional_api_service_google");
    case "elevenlabs":
      return localizer(locale, "commands.tool.status.optional_api_service_elevenlabs");
    case "novelai":
      return localizer(locale, "commands.tool.status.optional_api_service_novelai");
    default:
      return serviceName;
  }
}

function formatOptionalApiKeys(serviceNames: string[], locale: string): string {
  const labels = [...new Set(serviceNames.map((serviceName) => getOptionalApiServiceDisplayName(serviceName, locale)))];
  return formatConfiguredEntryNames(labels, locale);
}

function formatSavedProviderConfigs(savedConfigs: SavedProviderConfigRow[], locale: string): string {
  const providerLabels = [...new Set(savedConfigs.map((config) => getProviderDisplayName(config.provider)))];
  return formatConfiguredEntryNames(providerLabels, locale);
}

function getHiddenNoticeLabels(hiddenKeys: readonly string[], locale: string): string[] {
  return hiddenKeys
    .map((key) => {
      const definition = TOOL_NOTICE_DEFINITIONS.find((entry) => entry.key === key);
      return definition ? localizer(locale, definition.labelKey) : key;
    })
    .sort((left, right) => left.localeCompare(right));
}

function formatHiddenNoticeEmbeds(hiddenKeys: readonly string[], locale: string): string {
  return formatConfiguredEntryNames(getHiddenNoticeLabels(hiddenKeys, locale), locale);
}

function getMcpServerTypeLabel(serverType: string | null | undefined, locale: string): string {
  switch (serverType) {
    case "web_search":
      return localizer(locale, "commands.tool.status.mcp_server_type_web_search");
    case "url_fetcher":
      return localizer(locale, "commands.tool.status.mcp_server_type_url_fetcher");
    default:
      return localizer(locale, "commands.tool.status.mcp_server_type_custom");
  }
}

function formatMcpServers(servers: GuildMcpServerRow[], locale: string): string {
  if (servers.length === 0) {
    return localizer(locale, "commands.choices.none");
  }

  return servers
    .map((server, index) => {
      const enabledLabel = server.is_enabled
        ? localizer(locale, "commands.choices.enabled")
        : localizer(locale, "commands.choices.disabled");
      const typeLabel = getMcpServerTypeLabel(server.server_type, locale);
      const authLabel = server.auth_token
        ? localizer(locale, "commands.tool.status.mcp_server_auth_present")
        : localizer(locale, "commands.tool.status.mcp_server_auth_absent");
      return `${index + 1}. **${truncateText(server.name, 32)}** · ${enabledLabel} · ${typeLabel} · ${authLabel}`;
    })
    .join("\n");
}

async function formatMatrixLinks(client: Client, links: MatrixLinkStatusRow[], locale: string): Promise<string> {
  if (links.length === 0) {
    return localizer(locale, "commands.choices.none");
  }

  const channelIds = links.map((link) => link.channel_disc_id);
  if (channelIds.length > MAX_ITEMS_DISPLAY) {
    return localizer(locale, "commands.tool.status.item_count", {
      count: channelIds.length,
    });
  }

  const mentions = await Promise.all(channelIds.map((channelId) => resolveChannelMention(client, channelId, locale)));
  return mentions.map((mention, index) => `${index + 1}. ${mention}`).join("\n");
}

/**
 * Formats an ordered fallback chain (LLM + custom endpoint entries) as a numbered list.
 * Falls back gracefully to the legacy `fallback_llms` array when `fallback_chain` is empty.
 * @param fallbackChain - Resolved fallback entries from TomoriState.fallback_chain
 * @param fallbackLlms - Legacy resolved LLM rows from TomoriState.fallback_llms
 * @param locale - User locale
 * @param customModelName - Optional custom model name for label override
 * @param otherModelCodename - Optional other-model codename for label override
 * @returns Formatted numbered list, or localized "None" if empty
 */
function formatFallbackChain(
  fallbackChain: FallbackEntry[] | undefined,
  fallbackLlms: LlmRow[] | undefined,
  locale: string,
  customModelName?: string | null,
  otherModelCodename?: string | null,
): string {
  // 1. Prefer the typed fallback_chain; fall back to legacy fallback_llms list
  const hasChain = (fallbackChain?.length ?? 0) > 0;
  const hasLegacy = (fallbackLlms?.length ?? 0) > 0;

  if (!hasChain && !hasLegacy) {
    return localizer(locale, "commands.choices.none");
  }

  if (hasChain && fallbackChain) {
    return fallbackChain
      .map((entry, index) => {
        const label =
          entry.kind === "llm"
            ? formatLlmDisplayLabel(entry.model, customModelName, otherModelCodename)
            : `\`${truncateText(entry.endpoint.display_name, 48)}\` (${localizer(locale, "commands.tool.status.custom_endpoint_capability_label", { capability: entry.endpoint.capability })})`;
        return `${index + 1}. ${label}`;
      })
      .join("\n");
  }

  // 2. Legacy path: plain LLM array
  return (fallbackLlms ?? [])
    .map((m, i) => `${i + 1}. ${formatLlmDisplayLabel(m, customModelName, otherModelCodename)}`)
    .join("\n");
}

/**
 * Formats the list of server or user custom endpoints as a numbered list.
 * URL is never shown per privacy rules; shows label, capability, api_style, and auth status.
 * @param endpoints - Array of custom endpoint rows
 * @param locale - User locale
 * @returns Formatted list, or localized "None" if empty
 */
function formatCustomEndpoints(endpoints: CustomEndpointRow[], locale: string): string {
  if (endpoints.length === 0) {
    return localizer(locale, "commands.choices.none");
  }

  return endpoints
    .map((ep, index) => {
      const authLabel = ep.requires_auth
        ? localizer(locale, "commands.tool.status.mcp_server_auth_present")
        : localizer(locale, "commands.tool.status.mcp_server_auth_absent");
      return `${index + 1}. **${truncateText(ep.display_name, 32)}** · ${ep.capability} · ${ep.api_style} · ${authLabel}`;
    })
    .join("\n");
}

/**
 * Formats the list of personal saved provider configs as a detailed numbered list.
 * Shows provider name, enabled capabilities, and whether an API key is present.
 * Raw key bytes are never shown per privacy rules.
 * @param configs - User's saved provider config rows
 * @param locale - User locale
 * @returns Formatted numbered list, or localized "None" if empty
 */
function formatUserSavedProviders(configs: UserSavedProviderConfigRow[], locale: string): string {
  if (configs.length === 0) {
    return localizer(locale, "commands.choices.none");
  }

  return configs
    .map((config, index) => {
      const providerLabel = getProviderDisplayName(config.provider);
      const capabilities =
        config.enabled_capabilities.length > 0
          ? config.enabled_capabilities.join(", ")
          : localizer(locale, "commands.tool.status.personal_provider_no_capabilities");
      const keyLabel = config.api_key
        ? localizer(locale, "commands.tool.status.mcp_server_auth_present")
        : localizer(locale, "commands.tool.status.mcp_server_auth_absent");
      return `${index + 1}. **${providerLabel}** · ${capabilities} · ${keyLabel}`;
    })
    .join("\n");
}

function formatRotationPoolValue(keys: TomoriState["rotation_keys"], locale: string): string {
  const rotationKeys = keys ?? [];
  const totalEntries = rotationKeys.length;
  const additionalKeys = rotationKeys.filter((key) => !key.is_main_key_pointer).length;
  const enabledEntries = rotationKeys.filter((key) => key.is_enabled).length;
  const disabledEntries = totalEntries - enabledEntries;

  return totalEntries === 0
    ? localizer(locale, "commands.choices.none")
    : localizer(locale, "commands.tool.status.field_api_key_rotation_pool_value", {
        total: totalEntries,
        additional: additionalKeys,
        enabled: enabledEntries,
        disabled: disabledEntries,
      });
}

function formatActiveStPresetValue(activePreset: StPresetRow | null, locale: string): string {
  return activePreset?.preset_name ?? localizer(locale, "commands.choices.none");
}

function formatStPresetNodeSummary(toggleableNodes: StPresetNodeRow[], locale: string): string {
  if (toggleableNodes.length === 0) {
    return localizer(locale, "commands.choices.none");
  }

  const enabledCount = toggleableNodes.filter((node) => node.is_enabled).length;
  return localizer(locale, "commands.tool.status.field_st_preset_nodes_value", {
    enabled: enabledCount,
    total: toggleableNodes.length,
  });
}

/**
 * Configures the 'status' subcommand with scope options.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("status")
    .setDescription(localizer("en-US", "commands.tool.status.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.tool.status.scope_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.tool.status.scope_choice_server_model"),
            value: "server_model",
          },
          {
            name: localizer("en-US", "commands.tool.status.scope_choice_server_config"),
            value: "server_config",
          },
          {
            name: localizer("en-US", "commands.tool.status.scope_choice_server_channels"),
            value: "server_channels",
          },
          {
            name: localizer("en-US", "commands.tool.status.scope_choice_personal"),
            value: "personal",
          },
          {
            name: localizer("en-US", "commands.tool.status.scope_choice_persona"),
            value: "persona",
          },
        ),
    );

/**
 * Executes the 'status' command.
 * Displays paginated status pages for the selected scope (personal, server, or persona).
 * @param client - The Discord client instance
 * @param interaction - The chat input command interaction
 * @param userData - The user data row from the database
 * @param locale - The user's preferred locale
 */
export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const serverDiscId = interaction.guildId ?? interaction.user.id;
  const scope = interaction.options.getString("scope", true);
  const limits = getMemoryLimits();

  try {
    switch (scope) {
      case "personal": {
        // 1. Load global personal memories, personal provider configs, and custom endpoints in parallel
        let globalPersonalMemoryList: string[] = [];
        let userSavedProviderConfigs: UserSavedProviderConfigRow[] = [];
        let userCustomEndpoints: CustomEndpointRow[] = [];
        if (userData.user_id) {
          [globalPersonalMemoryList, userSavedProviderConfigs, userCustomEndpoints] = await Promise.all([
            loadPersonalMemoriesForUserLineage(userData.user_id, 0, false).then((rows) =>
              rows.map((row) => row.content),
            ),
            loadUserSavedProviderConfigs(userData.user_id),
            loadCustomEndpointsForUser(userData.user_id),
          ]);
        }

        // 2. Format global personal memories (all shown, 100-char truncation each)
        const globalPersonalMemoriesValue = formatNumberedList(
          globalPersonalMemoryList,
          locale,
          MEMORY_TRUNCATE_LENGTH,
        );
        const globalPersonalMemoriesCount = globalPersonalMemoryList.length;

        // 3. Get the user's active reminder count
        const reminderCount = await getUserReminderCount(interaction.user.id);
        const rawImpersonationPrompt = userData.impersonation_prompt?.trim() ?? null;
        const impersonationPromptValue = rawImpersonationPrompt
          ? `\`\`\`\n${
              rawImpersonationPrompt.length > MAX_PROMPT_PREVIEW
                ? `${rawImpersonationPrompt.slice(0, MAX_PROMPT_PREVIEW)}...`
                : rawImpersonationPrompt
            }\n\`\`\``
          : localizer(locale, "commands.tool.status.field_impersonation_prompt_not_set");

        // 4. Format personal provider and endpoint data
        const userSavedProvidersValue = formatUserSavedProviders(userSavedProviderConfigs, locale);
        const userCustomEndpointsValue = formatCustomEndpoints(userCustomEndpoints, locale);

        // 5. Build Page 1: personal settings and global personal memory
        const personalPage: SummaryEmbedOptions = {
          titleKey: "commands.tool.status.personal_title",
          descriptionKey: "commands.tool.status.personal_description",
          color: ColorCode.INFO,
          footerKey: "commands.tool.status.export_footer_global_personal_memories",
          fields: [
            {
              nameKey: "commands.tool.status.field_user_nickname",
              value: userData.user_nickname,
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_language_pref",
              value: userData.language_pref,
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_privacy",
              value: getPrivacyLevelLabel(locale, userData.privacy_level ?? PrivacyLevel.MINIMAL),
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_impersonation_prompt",
              value: impersonationPromptValue,
              inline: false,
            },
            {
              nameKey: "commands.tool.status.field_reminders_count",
              value: String(reminderCount),
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_personal_dtm",
              value: localizer(
                locale,
                `commands.personal.deliberatetriggermode.${userData.personal_dtm ?? "follow"}_option`,
              ),
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_personal_deliberate_tool_mode",
              value: localizer(
                locale,
                `commands.personal.deliberatetoolmode.${userData.personal_deliberate_tool_mode ?? "follow"}_option`,
              ),
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_crossserver_stm",
              value: formatBooleanLocalized(userData.shortterm_cache_crossserver_opt_in ?? false, locale),
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_nai_char_tags",
              value:
                (userData.nai_char_tags?.length ?? 0) > 0
                  ? `${userData.nai_char_tags.length} tags`
                  : localizer(locale, "commands.choices.none"),
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_nai_char_ref",
              value: formatBooleanLocalized(!!userData.nai_char_ref_url, locale),
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_global_personal_memories_with_count",
              nameVars: {
                current: globalPersonalMemoriesCount,
                max: limits.maxPersonalMemories,
              },
              value: globalPersonalMemoriesValue,
              inline: false,
            },
          ],
        };

        // 6. Build Page 2: personal providers and custom endpoints
        const personalProvidersPage: SummaryEmbedOptions = {
          titleKey: "commands.tool.status.personal_page2_title",
          descriptionKey: "commands.tool.status.personal_page2_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.tool.status.field_personal_providers_with_count",
              nameVars: { count: userSavedProviderConfigs.length },
              value: userSavedProvidersValue,
              inline: false,
            },
            {
              nameKey: "commands.tool.status.field_personal_custom_endpoints_with_count",
              nameVars: { count: userCustomEndpoints.length },
              value: userCustomEndpointsValue,
              inline: false,
            },
          ],
        };

        await replyPaginatedStatusPages(
          interaction,
          locale,
          [personalPage, personalProvidersPage],
          MessageFlags.Ephemeral,
        );
        break;
      }

      case "server_model":
      case "server_config":
      case "server_channels": {
        // 1. Load Tomori state — required by all three server scopes
        const tomoriState = await getCachedTomoriState(serverDiscId);

        if (!tomoriState) {
          await replyInfoEmbed(interaction, locale, {
            titleKey: "general.errors.tomori_not_setup_title",
            descriptionKey: "general.errors.tomori_not_setup_description",
            color: ColorCode.ERROR,
          });
          return;
        }

        const config = tomoriState.config;
        const llm = tomoriState.llm;

        // ── server_model: pages 1, 6, 7, 8 ────────────────────────────
        if (scope === "server_model") {
          // 2. Load model-related data in parallel
          const [
            allPersonas,
            channelLlmOverrides,
            imageQuotaConfig,
            textQuotaConfig,
            videoQuotaConfig,
            diffusionModel,
            embeddingModel,
            videoModel,
            naiDiffusionModel,
            speechModel,
            transcriptionModel,
          ] = await Promise.all([
            loadAllPersonasForServer(serverDiscId),
            getAllChannelLlmOverridesForServer(tomoriState.server_id),
            getQuotaConfig(tomoriState.server_id),
            getTextQuotaConfig(tomoriState.server_id),
            getVideoQuotaConfig(tomoriState.server_id),
            config.diffusion_model_id ? getDiffusionModelById(config.diffusion_model_id) : Promise.resolve(null),
            config.embedding_model_id ? loadEmbeddingModelById(config.embedding_model_id) : Promise.resolve(null),
            config.video_model_id ? loadVideoModelById(config.video_model_id) : Promise.resolve(null),
            config.nai_diffusion_model_id
              ? getDiffusionModelById(config.nai_diffusion_model_id)
              : Promise.resolve(null),
            resolveActiveSpeechEndpoint(tomoriState.server_id),
            resolveActiveTranscriptionEndpoint(tomoriState.server_id),
          ]);

          // 3. Format model display values
          const modelValue = config.llm_id
            ? formatLlmDisplayLabel(llm, config.custom_model_name, config.other_model_codename)
            : config.user_byok_mode
              ? localizer(locale, "commands.choices.none_user_byok")
              : localizer(locale, "commands.choices.none");
          const visionModelValue = tomoriState.vision_llm
            ? formatLlmDisplayLabel(tomoriState.vision_llm, config.custom_model_name, config.other_model_codename)
            : localizer(locale, "commands.choices.none");
          const fallbackModelsValue = formatFallbackChain(
            tomoriState.fallback_chain,
            tomoriState.fallback_llms,
            locale,
            config.custom_model_name,
            config.other_model_codename,
          );
          const logitBiasesValue =
            config.llm_logit_biases.length > 0
              ? localizer(locale, "commands.tool.status.item_count", { count: config.llm_logit_biases.length })
              : localizer(locale, "commands.choices.none");
          const diffusionModelValue = diffusionModel
            ? `${diffusionModel.codename} (${diffusionModel.provider})`
            : localizer(locale, "commands.choices.none");
          const videoModelValue = videoModel
            ? `${videoModel.codename} (${videoModel.provider})`
            : localizer(locale, "commands.choices.none");
          const embeddingModelValue = embeddingModel
            ? `${embeddingModel.codename} (${embeddingModel.provider})`
            : localizer(locale, "commands.choices.none");
          const speechModelValue = speechModel
            ? `${speechModel.endpoint.display_name} (${speechModel.endpoint.api_style})`
            : localizer(locale, "commands.choices.none");
          const transcriptionModelValue = transcriptionModel
            ? `${transcriptionModel.endpoint.display_name} (${transcriptionModel.endpoint.api_style})`
            : localizer(locale, "commands.choices.none");
          const customEndpointConfiguredValue = formatBooleanLocalized(!!config.custom_endpoint_url, locale);
          const naiDiffusionModelValue = naiDiffusionModel
            ? `${naiDiffusionModel.codename} (${naiDiffusionModel.provider})`
            : localizer(locale, "commands.choices.none");
          const channelLlmOverridesValue = await formatChannelLlmOverrides(
            client,
            channelLlmOverrides,
            locale,
            config.custom_model_name,
            config.other_model_codename,
          );
          const personaLlmOverridesValue = formatPersonaLlmOverrides(
            allPersonas,
            locale,
            config.custom_model_name,
            config.other_model_codename,
          );

          // ── Page 1: Model & Sampling ───────────────────────────────────
          const serverPage1: SummaryEmbedOptions = {
            titleKey: "commands.tool.status.server_page1_title",
            descriptionKey: "commands.tool.status.server_page1_description",
            color: ColorCode.INFO,
            fields: [
              {
                nameKey: "commands.tool.status.field_model",
                value: modelValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_speech_model",
                value: speechModelValue,
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_transcription_model",
                value: transcriptionModelValue,
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_temperature",
                value: String(config.llm_temperature),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_top_p",
                value: String(config.llm_top_p),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_top_k",
                value: String(config.llm_top_k),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_min_p",
                value: String(config.llm_min_p),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_frequency_penalty",
                value: String(config.llm_frequency_penalty),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_presence_penalty",
                value: String(config.llm_presence_penalty),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_omitted_params",
                value: formatOmittedSamplingParams(config.llm_disabled_params, locale),
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_humanizer",
                value: String(config.humanizer_degree),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_thinking_level",
                value: getThinkingLevelLabel(locale, config.thinking_level),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_vision_model",
                value: visionModelValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_fallback_models",
                value: fallbackModelsValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_logit_biases",
                value: logitBiasesValue,
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_diffusion_model",
                value: diffusionModelValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_video_model",
                value: videoModelValue,
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_embedding_model",
                value: embeddingModelValue,
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_custom_endpoint",
                value: customEndpointConfiguredValue,
                inline: true,
              },
            ],
          };

          // ── Page 2: Model Overrides ─────────────────────────────────────
          const serverPage2: SummaryEmbedOptions = {
            titleKey: "commands.tool.status.server_page6_title",
            descriptionKey: "commands.tool.status.server_page6_description",
            color: ColorCode.INFO,
            fields: [
              {
                nameKey: "commands.tool.status.field_channel_llm_overrides",
                value: channelLlmOverridesValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_persona_llm_overrides",
                value: personaLlmOverridesValue,
                inline: false,
              },
            ],
          };

          // ── Page 3: Quotas ──────────────────────────────────────────────
          const serverPage3: SummaryEmbedOptions = {
            titleKey: "commands.tool.status.server_page7_title",
            descriptionKey: "commands.tool.status.server_page7_description",
            color: ColorCode.INFO,
            fields: [
              {
                nameKey: "commands.tool.status.field_image_quota_enabled",
                value: formatBooleanLocalized(imageQuotaConfig.enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_image_quota_daily_user",
                value: formatQuotaLimitValue(locale, imageQuotaConfig.daily_user_quota),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_image_quota_serverwide",
                value: formatQuotaLimitValue(locale, imageQuotaConfig.serverwide_quota),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_image_quota_reset_days",
                value: localizer(locale, "commands.tool.status.field_quota_reset_days_value", {
                  days: imageQuotaConfig.serverwide_quota_resets_in,
                }),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_text_quota_enabled",
                value: formatBooleanLocalized(textQuotaConfig.enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_text_quota_daily_user",
                value: formatQuotaLimitValue(locale, textQuotaConfig.daily_user_quota),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_text_quota_serverwide",
                value: formatQuotaLimitValue(locale, textQuotaConfig.serverwide_quota),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_text_quota_reset_days",
                value: localizer(locale, "commands.tool.status.field_quota_reset_days_value", {
                  days: textQuotaConfig.serverwide_quota_resets_in,
                }),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_video_quota_enabled",
                value: formatBooleanLocalized(videoQuotaConfig.enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_video_quota_daily_user",
                value: formatQuotaLimitValue(locale, videoQuotaConfig.daily_user_quota),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_video_quota_serverwide",
                value: formatQuotaLimitValue(locale, videoQuotaConfig.serverwide_quota),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_video_quota_reset_days",
                value: localizer(locale, "commands.tool.status.field_quota_reset_days_value", {
                  days: videoQuotaConfig.serverwide_quota_resets_in,
                }),
                inline: true,
              },
            ],
          };

          // ── Page 4: NAI Image Config ────────────────────────────────────
          const serverPage4: SummaryEmbedOptions = {
            titleKey: "commands.tool.status.server_page8_title",
            descriptionKey: "commands.tool.status.server_page8_description",
            color: ColorCode.INFO,
            fields: [
              {
                nameKey: "commands.tool.status.field_nai_diffusion_model",
                value: naiDiffusionModelValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_nai_preset",
                value: config.nai_preset_name ?? localizer(locale, "commands.choices.none"),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_nai_sampler",
                value: config.nai_sampler ?? localizer(locale, "commands.choices.none"),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_nai_steps",
                value: config.nai_steps != null ? String(config.nai_steps) : localizer(locale, "commands.choices.none"),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_nai_scale",
                value: config.nai_scale != null ? String(config.nai_scale) : localizer(locale, "commands.choices.none"),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_nai_noise_schedule",
                value: config.nai_noise_schedule ?? localizer(locale, "commands.choices.none"),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_nai_cfg_rescale",
                value:
                  config.nai_cfg_rescale != null
                    ? String(config.nai_cfg_rescale)
                    : localizer(locale, "commands.choices.none"),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_nai_style_tags",
                value:
                  config.nai_style_tags.length > 0
                    ? config.nai_style_tags.join(", ")
                    : localizer(locale, "commands.choices.none"),
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_nai_negative_tags",
                value:
                  config.nai_negative_tags.length > 0
                    ? config.nai_negative_tags.join(", ")
                    : localizer(locale, "commands.choices.none"),
                inline: false,
              },
            ],
          };

          await replyPaginatedStatusPages(
            interaction,
            locale,
            [serverPage1, serverPage2, serverPage3, serverPage4],
            MessageFlags.Ephemeral,
          );
          break;
        }

        // ── server_config: pages 1-4 (Behavior, Features, System Prompt, Integrations) ─
        if (scope === "server_config") {
          // 2. Load config-related data in parallel
          const [optApiKeyRows, savedProviderConfigs, guildMcpServers, matrixLinks, stPresets, serverCustomEndpoints] =
            await Promise.all([
              sql<OptApiKeyStatusRow[]>`
              SELECT service_name FROM opt_api_keys
              WHERE server_id = ${tomoriState.server_id}
              ORDER BY service_name ASC
            `,
              loadSavedProviderConfigs(tomoriState.server_id),
              loadGuildMcpServers(tomoriState.server_id),
              sql<MatrixLinkStatusRow[]>`
              SELECT channel_disc_id FROM matrix_channel_links
              WHERE server_id = ${tomoriState.server_id}
              ORDER BY created_at ASC
            `,
              loadPresetsForServer(tomoriState.server_id),
              loadCustomEndpointsForServer(tomoriState.server_id),
            ]);

          const activeStPreset = stPresets.find((preset) => preset.is_active) ?? null;
          const activeStPresetNodes =
            activeStPreset?.preset_id != null ? await loadToggleableNodes(activeStPreset.preset_id) : [];

          // 3. Format behavior values
          const timezoneOffset = config.timezone_offset;
          const timezoneSign = timezoneOffset >= 0 ? "+" : "-";
          const timezoneHours = Math.abs(timezoneOffset).toString().padStart(2, "0");
          const timezoneValue = `UTC${timezoneSign}${timezoneHours}:00`;
          const cooldownType = config.cooldown_type ?? CooldownType.OFF;
          const cooldownTypeLabel = getCooldownTypeLabel(locale, cooldownType);
          const cooldownLengthValue =
            cooldownType === CooldownType.OFF
              ? localizer(locale, "commands.choices.disabled")
              : localizer(locale, "commands.tool.status.field_cooldown_length_value", {
                  seconds: config.cooldown_length,
                });
          const autochThresholdMax =
            config.autoch_threshold_max > 0
              ? Math.max(config.autoch_threshold_max, config.autoch_threshold)
              : config.autoch_threshold;
          const autochModeValue =
            config.autoch_threshold === 0
              ? localizer(locale, "commands.choices.always")
              : autochThresholdMax > config.autoch_threshold
                ? `${config.autoch_threshold}-${autochThresholdMax}`
                : String(config.autoch_threshold);
          const serverUserByokToggleMention = commandRegistry.getCommandMention("server", "user-byok", "toggle");
          const userByokValue = localizer(
            locale,
            config.user_byok_mode
              ? "commands.tool.status.field_user_byok_enabled"
              : "commands.tool.status.field_user_byok_disabled",
            { toggle_command: serverUserByokToggleMention },
          );

          // 4. Format system prompt / context note previews
          const rawSystemPrompt = config.system_prompt ?? null;
          const systemPromptText = rawSystemPrompt
            ? rawSystemPrompt.length > MAX_PROMPT_PREVIEW
              ? `${rawSystemPrompt.slice(0, MAX_PROMPT_PREVIEW)}...`
              : rawSystemPrompt
            : DEFAULT_SYSTEM_PROMPT.trim();
          const systemPromptValue = `\`\`\`\n${systemPromptText}\n\`\`\``;
          const rawContextNote = config.context_note ?? null;
          const contextNoteValue = rawContextNote
            ? `\`\`\`\n${
                rawContextNote.length > MAX_PROMPT_PREVIEW
                  ? `${rawContextNote.slice(0, MAX_PROMPT_PREVIEW)}...`
                  : rawContextNote
              }\n\`\`\``
            : localizer(locale, "commands.tool.status.field_context_note_not_set");

          // 5. Format integrations / access values
          const optApiKeyServiceNames = optApiKeyRows.map((row) => row.service_name);
          const braveApiKeySet = optApiKeyServiceNames.includes("brave-search");
          const rotationKeys = tomoriState.rotation_keys ?? [];
          const rotationStatusValue =
            rotationKeys.length >= 2
              ? localizer(locale, "commands.choices.enabled")
              : localizer(locale, "commands.choices.disabled");
          const rotationPoolValue = formatRotationPoolValue(tomoriState.rotation_keys, locale);
          const optionalApiKeyCount = new Set(optApiKeyServiceNames.map((serviceName) => serviceName.toLowerCase()))
            .size;
          const optionalApiKeysValue = formatOptionalApiKeys(optApiKeyServiceNames, locale);
          const savedProviderConfigCount = new Set(
            savedProviderConfigs.map((savedConfig) => savedConfig.provider.toLowerCase()),
          ).size;
          const savedProviderConfigsValue = formatSavedProviderConfigs(savedProviderConfigs, locale);
          const hiddenNoticeKeys = config.tool_notice_hidden_keys ?? [];
          const hiddenNoticeEmbedsValue = formatHiddenNoticeEmbeds(hiddenNoticeKeys, locale);
          const stPresetLibraryValue = localizer(locale, "commands.tool.status.field_st_preset_library_value", {
            count: stPresets.length,
          });
          const activeStPresetValue = formatActiveStPresetValue(activeStPreset, locale);
          const stPresetNodeSummaryValue = formatStPresetNodeSummary(activeStPresetNodes, locale);
          const mcpServersValue = formatMcpServers(guildMcpServers, locale);
          const serverCustomEndpointsValue = formatCustomEndpoints(serverCustomEndpoints, locale);
          const matrixLinksValue = await formatMatrixLinks(client, matrixLinks, locale);

          // ── Page 1: Behavior ───────────────────────────────────────────
          const configPage1: SummaryEmbedOptions = {
            titleKey: "commands.tool.status.server_page2_title",
            descriptionKey: "commands.tool.status.server_page2_description",
            color: ColorCode.INFO,
            fields: [
              {
                nameKey: "commands.tool.status.field_timezone",
                value: timezoneValue,
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_message_fetch_limit",
                value: String(config.message_fetch_limit),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_cascade_limit",
                value: String(config.cascade_limit),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_send_message_limit",
                value:
                  (config.send_message_limit ?? 0) > 0
                    ? String(config.send_message_limit)
                    : localizer(locale, "commands.choices.disabled"),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_always_reply",
                value: config.always_reply_enabled
                  ? localizer(locale, "commands.choices.enabled")
                  : localizer(locale, "commands.choices.disabled"),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_match_limit",
                value: String(config.match_limit),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_cooldown_type",
                value: cooldownTypeLabel,
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_cooldown_length",
                value: cooldownLengthValue,
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_autoch_threshold",
                value: autochModeValue,
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_deliberate_trigger",
                value: formatBooleanLocalized(config.deliberate_trigger_mode ?? false, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_deliberate_tool_mode",
                value: formatBooleanLocalized(config.deliberate_tool_mode ?? false, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_deliberate_tool_context_turns",
                value: resolveDeliberateToolContextTurns(config.deliberate_tool_context_turns).toString(),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_user_byok",
                value: userByokValue,
                inline: false,
              },
            ],
          };

          // ── Page 2: Features & Moderation ──────────────────────────────
          const configPage2: SummaryEmbedOptions = {
            titleKey: "commands.tool.status.server_page4_title",
            descriptionKey: "commands.tool.status.server_page4_description",
            color: ColorCode.INFO,
            fields: [
              {
                nameKey: "commands.tool.status.field_personalization",
                value: formatBooleanLocalized(config.personal_memories_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_self_teach",
                value: formatBooleanLocalized(config.self_teaching_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_image_generation",
                value: formatBooleanLocalized(config.imagegen_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_videogen",
                value: formatBooleanLocalized(config.videogen_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_web_search",
                value: formatBooleanLocalized(config.web_search_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_manage_message",
                value: formatBooleanLocalized(config.manage_message_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_emoji_usage",
                value: formatBooleanLocalized(config.emoji_usage_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_sticker_usage",
                value: formatBooleanLocalized(config.sticker_usage_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_api_key_set",
                value: formatBooleanLocalized(!!config.api_key, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_brave_api_key_set",
                value: formatBooleanLocalized(braveApiKeySet, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_server_memteaching",
                value: formatBooleanLocalized(config.server_memteaching_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_attribute_memteaching",
                value: formatBooleanLocalized(config.attribute_memteaching_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_sampledialogue_memteaching",
                value: formatBooleanLocalized(config.sampledialogue_memteaching_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_hide_impersonation",
                value: formatBooleanLocalized(!isNoticeEmbedVisible(config, "impersonation_notice"), locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_hide_respond_embed",
                value: formatBooleanLocalized(!isNoticeEmbedVisible(config, "respond_embed"), locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_self_debug",
                value: formatBooleanLocalized(config.self_debug_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_uncensor_injection",
                value: formatBooleanLocalized(config.uncensor_injection_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_uncensor_unicode",
                value: formatBooleanLocalized(config.uncensor_unicode_space_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_uncensor_sanitize",
                value: formatBooleanLocalized(config.uncensor_sanitize_enabled, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_tool_use",
                value: formatBooleanLocalized(config.tool_use_enabled ?? true, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_prompt_snapshot",
                value: formatBooleanLocalized(config.prompt_snapshot_enabled ?? false, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_stm_privacy_bypass",
                value: formatBooleanLocalized(config.stm_privacy_bypass ?? false, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_voice_messages",
                value: formatBooleanLocalized(config.voice_message_enabled ?? true, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_voice_transcript_mode",
                value: formatBooleanLocalized(config.voice_transcript_chat_mode ?? true, locale),
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_nai_exclusive_imggen",
                value: formatBooleanLocalized(config.nai_exclusive_imggen ?? false, locale),
                inline: true,
              },
            ],
          };

          // ── Page 3: System Prompt & Author's Note ───────────────────────
          const configPage3: SummaryEmbedOptions = {
            titleKey: "commands.tool.status.server_page5_title",
            descriptionKey: "commands.tool.status.server_page5_description",
            color: ColorCode.INFO,
            footerKey: "commands.tool.status.export_footer_server_config",
            fields: [
              {
                nameKey: "commands.tool.status.field_system_prompt",
                value: systemPromptValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_context_note",
                value: contextNoteValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_context_note_depth",
                value: String(config.context_note_depth ?? 0),
                inline: true,
              },
            ],
          };

          // ── Page 4: Integrations & Access ───────────────────────────────
          const configPage4: SummaryEmbedOptions = {
            titleKey: "commands.tool.status.server_page9_title",
            descriptionKey: "commands.tool.status.server_page9_description",
            color: ColorCode.INFO,
            fields: [
              {
                nameKey: "commands.tool.status.field_api_key_rotation_status",
                value: rotationStatusValue,
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_api_key_rotation_pool",
                value: rotationPoolValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_optional_api_keys_with_count",
                nameVars: { count: optionalApiKeyCount },
                value: optionalApiKeysValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_saved_provider_configs_with_count",
                nameVars: { count: savedProviderConfigCount },
                value: savedProviderConfigsValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_server_custom_endpoints_with_count",
                nameVars: { count: serverCustomEndpoints.length },
                value: serverCustomEndpointsValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_mcp_servers_with_count",
                nameVars: { count: guildMcpServers.length },
                value: mcpServersValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_matrix_links_with_count",
                nameVars: { count: matrixLinks.length },
                value: matrixLinksValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_hidden_notice_embeds_with_count",
                nameVars: { count: hiddenNoticeKeys.length },
                value: hiddenNoticeEmbedsValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_st_preset_active",
                value: activeStPresetValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_st_preset_library",
                value: stPresetLibraryValue,
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_st_preset_nodes",
                value: stPresetNodeSummaryValue,
                inline: true,
              },
            ],
          };

          await replyPaginatedStatusPages(
            interaction,
            locale,
            [configPage1, configPage2, configPage3, configPage4],
            MessageFlags.Ephemeral,
          );
          break;
        }

        // ── server_channels: single page (Channels & Automation) ────────
        if (scope === "server_channels") {
          // 2. Load channel-related data in parallel
          const [
            blacklistedMemberIds,
            whitelistPersonas,
            whitelistChannels,
            whitelistRoles,
            randomTriggers,
            allPersonas,
          ] = await Promise.all([
            getBlacklistedMemberIds(tomoriState.server_id),
            getAllWhitelistPersonas(tomoriState.server_id),
            getAllWhitelistChannels(tomoriState.server_id),
            getAllWhitelistRoles(tomoriState.server_id),
            getServerRandomTriggers(tomoriState.server_id),
            loadAllPersonasForServer(serverDiscId),
          ]);

          // 3. Build persona name map for autochat / welcome / trigger display
          const personaNameMap = new Map<number, string>();
          for (const persona of allPersonas) {
            if (persona.tomori_id) {
              personaNameMap.set(persona.tomori_id, persona.tomori_nickname);
            }
          }
          const mainPersonaName =
            allPersonas.find((persona) => !persona.is_alter)?.tomori_nickname ??
            localizer(locale, "commands.choices.none");

          // 4. Format blacklisted members
          const blacklistedCount = blacklistedMemberIds.length;
          const blacklistedValue =
            blacklistedCount === 0
              ? localizer(locale, "commands.choices.none")
              : blacklistedCount <= MAX_ITEMS_DISPLAY
                ? blacklistedMemberIds.map((id) => `<@${id}>`).join(", ")
                : localizer(locale, "commands.tool.status.field_blacklisted_members_with_count", {
                    current: blacklistedCount,
                  });

          // 5. Format all channel / whitelist / trigger values
          const [
            autoChannelsValue,
            rpChannelsValue,
            privateChannelsValue,
            crosschannelBlocklistValue,
            welcomeChannelValue,
            thoughtLogChannelValue,
            whitelistPersonasValue,
            whitelistValue,
            whitelistRolesValue,
            randomTriggersValue,
          ] = await Promise.all([
            formatAutochatChannels(client, config, personaNameMap, mainPersonaName, locale),
            formatChannelList(client, config.rp_channel_ids, locale),
            formatChannelList(client, config.private_channel_ids, locale),
            formatChannelList(client, config.crosschannel_blocklist_ids ?? [], locale),
            formatWelcomeChannel(client, config, personaNameMap, locale),
            formatChannelList(
              client,
              config.thought_log_channel_disc_id ? [config.thought_log_channel_disc_id] : [],
              locale,
            ),
            formatWhitelistPersonaEntries(client, whitelistPersonas, personaNameMap, locale),
            formatWhitelistEntries(client, whitelistChannels, locale),
            formatWhitelistRolesEntries(whitelistRoles, locale),
            formatRandomTriggers(client, randomTriggers, personaNameMap, locale),
          ]);
          const welcomePromptConfiguredValue = formatBooleanLocalized(!!config.welcome_prompt?.trim(), locale);

          // ── Page 1: Channels & Automation ──────────────────────────────
          const channelsPage: SummaryEmbedOptions = {
            titleKey: "commands.tool.status.server_page3_title",
            descriptionKey: "commands.tool.status.server_page3_description",
            color: ColorCode.INFO,
            fields: [
              {
                nameKey: "commands.tool.status.field_autoch_channels",
                value: autoChannelsValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_rp_channels",
                value: rpChannelsValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_private_channels",
                value: privateChannelsValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_crosschannel_blocklist",
                value: crosschannelBlocklistValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_welcome_channel",
                value: welcomeChannelValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_welcome_prompt",
                value: welcomePromptConfiguredValue,
                inline: true,
              },
              {
                nameKey: "commands.tool.status.field_thought_logs_channel",
                value: thoughtLogChannelValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_whitelist_personas",
                value: whitelistPersonasValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_whitelist_channels",
                value: whitelistValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_whitelist_roles",
                value: whitelistRolesValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_random_triggers",
                value: randomTriggersValue,
                inline: false,
              },
              {
                nameKey: "commands.tool.status.field_blacklisted_members",
                value: blacklistedValue,
                inline: blacklistedCount <= MAX_ITEMS_DISPLAY,
              },
            ],
          };

          await replyPaginatedStatusPages(interaction, locale, [channelsPage], MessageFlags.Ephemeral);
          break;
        }
        break;
      }

      case "persona": {
        // 1. Load all personas for the picker
        const allPersonas = await loadAllPersonasForServer(serverDiscId);

        if (allPersonas.length === 0) {
          await replyInfoEmbed(interaction, locale, {
            titleKey: "general.errors.tomori_not_setup_title",
            descriptionKey: "general.errors.tomori_not_setup_description",
            color: ColorCode.ERROR,
          });
          return;
        }

        // 2. Show paginated persona picker (Pattern 4 — preserves interaction)
        const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
          personas: allPersonas,
          color: ColorCode.INFO,
          preserveSelectedInteraction: true,
          onSelect: async () => {},
        });

        if (
          !personaSelection.success ||
          personaSelection.selectedIndex === undefined ||
          !personaSelection.interaction
        ) {
          return;
        }

        const personaInteraction: ButtonInteraction = personaSelection.interaction;
        const selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;

        if (!selectedPersona?.tomori_id) {
          await replyInfoEmbed(personaInteraction, locale, {
            titleKey: "general.errors.invalid_option_title",
            descriptionKey: "general.errors.invalid_option_description",
            color: ColorCode.ERROR,
          });
          return;
        }

        const personaName = selectedPersona.tomori_nickname;
        const personaLineageId = selectedPersona.persona_lineage_id ?? 0;

        // 3. Load persona-scoped personal memories for the requesting user
        let personaPersonalMemoryList: string[] = [];
        if (userData.user_id) {
          const personaPersonalMemoryRows = await loadPersonalMemoriesForUserLineage(
            userData.user_id,
            personaLineageId,
            false,
          );
          personaPersonalMemoryList = personaPersonalMemoryRows.map((row) => row.content);
        }

        // 4. Persona-scoped server memories are already attached to the persona state
        const personaServerMemoryList = selectedPersona.server_memories ?? [];

        // 5. Format attributes (all shown, 200-char truncation each)
        const attributesCount = selectedPersona.attribute_list.length;
        const attributesValue = formatBulletList(selectedPersona.attribute_list, locale, ATTRIBUTE_TRUNCATE_LENGTH);

        // 6. Format sample dialogues with actual truncated content
        const dialogueCount = Math.max(
          selectedPersona.sample_dialogues_in.length,
          selectedPersona.sample_dialogues_out.length,
        );
        const sampleDialoguesValue = formatSampleDialogues(
          selectedPersona.sample_dialogues_in,
          selectedPersona.sample_dialogues_out,
          locale,
          DIALOGUE_TRUNCATE_LENGTH,
        );

        // 7. Format persona-scoped memory content
        const personaPersonalMemoriesCount = personaPersonalMemoryList.length;
        const personaPersonalMemoriesValue = formatNumberedList(
          personaPersonalMemoryList,
          locale,
          MEMORY_TRUNCATE_LENGTH,
        );
        const personaServerMemoriesCount = personaServerMemoryList.length;
        const personaServerMemoriesValue = formatNumberedList(personaServerMemoryList, locale, MEMORY_TRUNCATE_LENGTH);

        // 8. Format alter/persona trigger words
        const alterTriggersValue =
          selectedPersona.alter_triggers.length > 0
            ? selectedPersona.alter_triggers.map((t) => `\`${t}\``).join(", ")
            : localizer(locale, "commands.choices.none");

        const personaTriggersValue =
          selectedPersona.trigger_words.length > 0
            ? selectedPersona.trigger_words.map((t) => `\`${t}\``).join(", ")
            : localizer(locale, "commands.choices.none");

        // 9. Format NAI tags
        const naiTagsValue =
          selectedPersona.nai_tags.length > 0
            ? selectedPersona.nai_tags.join(", ")
            : localizer(locale, "commands.choices.none");

        // 10. Build persona model override value
        //     Shows the persona-specific LLM if set, otherwise "Server default"
        const personaModelValue = selectedPersona.persona_llm
          ? formatLlmDisplayLabel(
              selectedPersona.persona_llm,
              selectedPersona.config.custom_model_name,
              selectedPersona.config.other_model_codename,
            )
          : localizer(locale, "commands.tool.status.persona_model_server_default");

        // 11. Format ATTG metadata block
        //     Each field is shown individually; null fields display as "None"
        const noneLabel = localizer(locale, "commands.choices.none");
        const attgAuthor = selectedPersona.nai_attg_author ?? noneLabel;
        const attgTitle = selectedPersona.nai_attg_title ?? noneLabel;
        const attgTags = selectedPersona.nai_attg_tags ?? noneLabel;
        const attgGenre = selectedPersona.nai_attg_genre ?? noneLabel;
        const attgStars = selectedPersona.nai_attg_stars != null ? `${selectedPersona.nai_attg_stars}★` : noneLabel;
        const attgAllUnset =
          !selectedPersona.nai_attg_author &&
          !selectedPersona.nai_attg_title &&
          !selectedPersona.nai_attg_tags &&
          !selectedPersona.nai_attg_genre &&
          selectedPersona.nai_attg_stars == null;
        const attgValue = attgAllUnset
          ? localizer(locale, "commands.tool.status.nai_attg_not_set")
          : `Author: ${attgAuthor}\nTitle: ${attgTitle}\nTags: ${attgTags}\nGenre: ${attgGenre}\nStars: ${attgStars}`;

        // 13. Format persona prompt preview (code block, up to MAX_PROMPT_PREVIEW chars)
        const rawPersonaPrompt = selectedPersona.persona_prompt ?? null;
        const personaPromptValue = rawPersonaPrompt
          ? `\`\`\`\n${
              rawPersonaPrompt.length > MAX_PROMPT_PREVIEW
                ? `${rawPersonaPrompt.slice(0, MAX_PROMPT_PREVIEW)}...`
                : rawPersonaPrompt
            }\n\`\`\``
          : localizer(locale, "commands.tool.status.field_persona_prompt_not_set");

        // 14. Format persona author's note (context_note) preview for Page 5
        const rawPersonaContextNote = selectedPersona.context_note ?? null;
        const personaContextNoteValue = rawPersonaContextNote
          ? `\`\`\`\n${
              rawPersonaContextNote.length > MAX_PROMPT_PREVIEW
                ? `${rawPersonaContextNote.slice(0, MAX_PROMPT_PREVIEW)}...`
                : rawPersonaContextNote
            }\n\`\`\``
          : localizer(locale, "commands.tool.status.field_persona_context_note_not_set");

        // ── Page 1: Identity ───────────────────────────────────────────
        const personaPage1: SummaryEmbedOptions = {
          titleKey: "commands.tool.status.persona_page1_title",
          titleVars: { persona_name: personaName },
          descriptionKey: "commands.tool.status.persona_page1_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.tool.status.field_nickname",
              value: personaName,
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_is_alter",
              value: formatBooleanLocalized(selectedPersona.is_alter, locale),
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_alter_triggers",
              value: alterTriggersValue,
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_persona_triggers",
              value: personaTriggersValue,
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_persona_model",
              value: personaModelValue,
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_avatar",
              value: selectedPersona.webhook_avatar_url
                ? localizer(locale, "general.yes")
                : localizer(locale, "commands.choices.none"),
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_voice",
              value:
                selectedPersona.speech_voice_name ??
                selectedPersona.elevenlabs_voice_name ??
                localizer(locale, "commands.choices.none"),
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_persona_nai_ref",
              value: formatBooleanLocalized(!!selectedPersona.nai_char_ref_url, locale),
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_reward_conditioning",
              value: formatBooleanLocalized(selectedPersona.reward_conditioning_enabled ?? true, locale),
              inline: true,
            },
            {
              nameKey: "commands.tool.status.field_punish_conditioning",
              value: formatBooleanLocalized(selectedPersona.punish_conditioning_enabled ?? true, locale),
              inline: true,
            },
          ],
        };

        // ── Page 2: Attributes ─────────────────────────────────────────
        const personaPage2: SummaryEmbedOptions = {
          titleKey: "commands.tool.status.persona_page2_title",
          titleVars: { persona_name: personaName },
          descriptionKey: "commands.tool.status.persona_page2_description",
          color: ColorCode.INFO,
          footerKey: "commands.tool.status.export_footer_persona_attributes_and_dialogues",
          fields: [
            {
              nameKey: "commands.tool.status.field_attributes_with_count",
              nameVars: {
                current: attributesCount,
                max: limits.maxAttributes,
              },
              value: attributesValue,
              inline: false,
            },
          ],
        };

        // ── Page 3: Sample Dialogues ───────────────────────────────────
        const personaPage3: SummaryEmbedOptions = {
          titleKey: "commands.tool.status.persona_page3_title",
          titleVars: { persona_name: personaName },
          descriptionKey: "commands.tool.status.persona_page3_description",
          color: ColorCode.INFO,
          footerKey: "commands.tool.status.export_footer_persona_attributes_and_dialogues",
          fields: [
            {
              nameKey: "commands.tool.status.field_sample_dialogues_with_count",
              nameVars: {
                current: dialogueCount,
                max: limits.maxSampleDialogues,
              },
              value: sampleDialoguesValue,
              inline: false,
            },
          ],
        };

        // ── Page 4: Memories ───────────────────────────────────────────
        const personaPage4: SummaryEmbedOptions = {
          titleKey: "commands.tool.status.persona_page4_title",
          titleVars: { persona_name: personaName },
          descriptionKey: "commands.tool.status.persona_page4_description",
          color: ColorCode.INFO,
          footerKey: "commands.tool.status.export_footer_persona_memories",
          fields: [
            {
              nameKey: "commands.tool.status.field_persona_personal_memories_with_count",
              nameVars: {
                current: personaPersonalMemoriesCount,
                max: limits.maxPersonalMemories,
              },
              value: personaPersonalMemoriesValue,
              inline: false,
            },
            {
              nameKey: "commands.tool.status.field_persona_server_memories_with_count",
              nameVars: {
                current: personaServerMemoriesCount,
                max: limits.maxServerMemories,
              },
              value: personaServerMemoriesValue,
              inline: false,
            },
          ],
        };

        // ── Page 5: Prompt & Tags ──────────────────────────────────────
        const personaPage5: SummaryEmbedOptions = {
          titleKey: "commands.tool.status.persona_page5_title",
          titleVars: { persona_name: personaName },
          descriptionKey: "commands.tool.status.persona_page5_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.tool.status.field_persona_prompt",
              value: personaPromptValue,
              inline: false,
            },
            {
              nameKey: "commands.tool.status.field_nai_tags",
              value: naiTagsValue,
              inline: false,
            },
            {
              nameKey: "commands.tool.status.field_nai_attg",
              value: attgValue,
              inline: false,
            },
            {
              nameKey: "commands.tool.status.field_persona_context_note",
              value: personaContextNoteValue,
              inline: false,
            },
            {
              nameKey: "commands.tool.status.field_persona_context_note_depth",
              value: String(selectedPersona.context_note_depth ?? 0),
              inline: true,
            },
          ],
        };

        // 15. Display paginated persona status from the preserved ButtonInteraction
        await replyPaginatedStatusPages(
          personaInteraction,
          locale,
          [personaPage1, personaPage2, personaPage3, personaPage4, personaPage5],
          MessageFlags.Ephemeral,
        );
        break;
      }

      default:
        log.error(`Invalid status scope received: ${scope}`);
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        });
        return;
    }
  } catch (error) {
    log.error(`Error executing status command for scope ${scope}:`, error, {
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "status",
        scope,
        guildDiscordId: serverDiscId,
      },
    });
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
