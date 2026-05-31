import { ChannelType, EmbedBuilder } from "discord.js";
import type { CompactRoleplaySummary } from "@/types/misc/compact";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { SendableChannel } from "./types";

export function buildConversationEmbed(locale: string, summaryText: string, refresh: boolean): EmbedBuilder {
  const title = refresh
    ? localizer(locale, "commands.tool.compact.summary_title_refreshed")
    : localizer(locale, "commands.tool.compact.summary_title");

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(truncateEmbedDescription(summaryText))
    .setColor(ColorCode.SECTION);

  if (refresh) {
    embed.setFooter({ text: localizer(locale, "commands.tool.compact.refresh_footer") });
  }

  return embed;
}

export function buildRoleplayEmbeds(
  locale: string,
  summary: CompactRoleplaySummary,
  refresh: boolean,
  avatarMap?: Map<string, string>,
): EmbedBuilder[] {
  const sceneTitle = refresh
    ? localizer(locale, "commands.tool.compact.roleplay_scene_title_refreshed")
    : localizer(locale, "commands.tool.compact.roleplay_scene_title");
  const sceneDescription = `## ${localizer(locale, "commands.tool.compact.roleplay_scene_synopsis_header")}\n${summary.overall_scene_summary}`;
  const sceneEmbed = new EmbedBuilder()
    .setTitle(sceneTitle)
    .setDescription(truncateEmbedDescription(sceneDescription))
    .setColor(ColorCode.SECTION);

  if (refresh) {
    sceneEmbed.setFooter({ text: localizer(locale, "commands.tool.compact.refresh_footer") });
  }

  const embeds = [sceneEmbed];
  const fuzzyAvatarMap = buildFuzzyAvatarMap(avatarMap);
  const characterPrefix = localizer(locale, "commands.tool.compact.roleplay_character_title_prefix");

  for (const character of summary.characters) {
    const name = character.name || "Unknown";
    const lines = [
      `**${localizer(locale, "commands.tool.compact.roleplay_labels.current_goals")} ${name}**: ${character.current_goals || "Unknown"}`,
      `**${localizer(locale, "commands.tool.compact.roleplay_labels.emotional_status")} ${name}**: ${character.emotional_status || "Unknown"}`,
      `**${localizer(locale, "commands.tool.compact.roleplay_labels.physical_status")} ${name}**: ${character.physical_status || "Unknown"}`,
      `**${localizer(locale, "commands.tool.compact.roleplay_labels.appearance_clothing")} ${name}**: ${character.appearance_clothing || "Unknown"}`,
      `**${localizer(locale, "commands.tool.compact.roleplay_labels.inventory")} ${name}**: ${character.inventory || "Unknown"}`,
    ];
    const embed = new EmbedBuilder()
      .setTitle(`${characterPrefix} ${name}`)
      .setDescription(truncateEmbedDescription(lines.join("\n")))
      .setColor(ColorCode.SECTION);
    const avatarUrl = resolveCharacterAvatar(name, avatarMap, fuzzyAvatarMap);
    if (avatarUrl) embed.setThumbnail(avatarUrl);
    embeds.push(embed);
  }

  return embeds;
}

export function isDiscordThreadChannel(channel: unknown): boolean {
  if (!channel || typeof channel !== "object") return false;
  if ("isThread" in channel && typeof channel.isThread === "function") return channel.isThread();
  if (!("type" in channel)) return false;
  const channelType = Number((channel as { type: number }).type);
  return (
    channelType === ChannelType.PublicThread ||
    channelType === ChannelType.PrivateThread ||
    channelType === ChannelType.AnnouncementThread
  );
}

export async function sendEmbedsInChunks(channel: SendableChannel, embeds: EmbedBuilder[]): Promise<void> {
  const chunkSize = 10;
  for (let index = 0; index < embeds.length; index += chunkSize) {
    await channel.send({ embeds: embeds.slice(index, index + chunkSize) });
  }
}

function truncateEmbedDescription(text: string, maxLength = 4000): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function buildFuzzyAvatarMap(avatarMap?: Map<string, string>): Map<string, string> {
  const fuzzyAvatarMap = new Map<string, string>();
  if (!avatarMap) return fuzzyAvatarMap;

  for (const [nameKey, url] of avatarMap) {
    const normalized = normalizeNameForMatch(nameKey);
    if (normalized && !fuzzyAvatarMap.has(normalized)) fuzzyAvatarMap.set(normalized, url);
  }
  return fuzzyAvatarMap;
}

function resolveCharacterAvatar(
  characterName: string,
  avatarMap?: Map<string, string>,
  fuzzyAvatarMap = new Map<string, string>(),
): string | undefined {
  let avatarUrl = avatarMap?.get(characterName.trim().toLowerCase());
  const normalized = normalizeNameForMatch(characterName);
  if (!avatarUrl && normalized) avatarUrl = fuzzyAvatarMap.get(normalized);
  if (avatarUrl || !normalized || normalized.length < 3) return avatarUrl;

  let bestMatchKey = "";
  for (const [key, url] of fuzzyAvatarMap.entries()) {
    if (key.length < 3) continue;
    if ((normalized.includes(key) || key.includes(normalized)) && key.length > bestMatchKey.length) {
      bestMatchKey = key;
      avatarUrl = url;
    }
  }
  return avatarUrl;
}

function normalizeNameForMatch(value: string): string {
  return value
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}
