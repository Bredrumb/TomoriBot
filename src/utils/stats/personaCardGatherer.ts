/**
 * Gatherer for the per-invoker Persona Affinity infographic. Rendering remains
 * pure in statsInfographic.tsx; this module owns all DB, cache, and Discord
 * asset access.
 */
import type { Guild } from "discord.js";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { statRepository } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { loadStoredPersonaAvatarDataUri } from "@/utils/storage/avatarStorage";
import { extractCardPalette, loadTomoriconDataUri } from "@/utils/stats/cardColor";
import { loadStatsPersonaAvatarDataUri, loadStatsPresetAvatarLookup } from "@/utils/stats/personaAvatar";
import { type Timeframe, resolveWindowFrom } from "@/utils/stats/statsDashboard";
import type { BreakdownSegment, EmojiIcon, PersonaCardData } from "@/utils/stats/statsInfographic";

export interface GatherPersonaCardArgs {
  serverId: number;
  guildDiscId: string;
  lineageId: number;
  userId: number;
  username: string;
  userAvatarUrl?: string | null;
  locale: string;
  timeframe: Timeframe;
  guild: Guild;
}

async function resolveEmojiIcons(guild: Guild, entries: Array<{ key: string; count: number }>): Promise<EmojiIcon[]> {
  return Promise.all(
    [...entries]
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
      .map(async (entry) => {
        const emoji = guild.emojis.cache.find((candidate) => candidate.name === entry.key);
        const imageDataUri = emoji
          ? await loadStoredPersonaAvatarDataUri(emoji.imageURL({ extension: "png", size: 64 }))
          : null;
        return { name: entry.key, imageDataUri };
      }),
  );
}

function toSegments(entries: Array<{ key: string; count: number }>): BreakdownSegment[] {
  return entries.map((entry) => ({ label: entry.key, count: entry.count }));
}

function toEmotionSegments(entries: Array<{ emotion: string; count: number }>): BreakdownSegment[] {
  return entries.map((entry) => ({ label: entry.emotion, count: entry.count }));
}

export async function gatherPersonaCardData(args: GatherPersonaCardArgs): Promise<PersonaCardData> {
  await statRepository.flush();
  const { serverId, guildDiscId, lineageId, userId, username, userAvatarUrl, locale, timeframe, guild } = args;
  const windowFrom = resolveWindowFrom(timeframe);
  const windowArg = windowFrom ? { from: windowFrom } : {};

  const [
    tokenTotals,
    totalTriggers,
    estimatedCost,
    conditioning,
    emojiEntries,
    emotionEntries,
    toolEntries,
    memoryCount,
  ] = await Promise.all([
    statRepository.getTokenTotals({ userId, serverId, lineageId, ...windowArg }),
    statRepository.getMetricTotal({ metric: "message_sent", userId, serverId, lineageId, ...windowArg }),
    statRepository.getEstimatedCost({ userId, serverId, lineageId, ...windowArg }),
    statRepository.getConditioningTotals({ userId, serverId, lineageId }),
    statRepository.getMetricKeyBreakdown({ metric: "emoji_used", userId, serverId, lineageId, limit: 5, ...windowArg }),
    statRepository.getEmotionBreakdown({ userId, serverId, lineageId, limit: 4, ...windowArg }),
    statRepository.getMetricKeyBreakdown({ metric: "tool_used", userId, serverId, lineageId, limit: 4, ...windowArg }),
    timeframe === "all_time" ? statRepository.getPersonalMemoryCount({ userId, lineageId }) : Promise.resolve(null),
  ]);

  let personaName = `Persona #${lineageId}`;
  let personaAvatarDataUri: string | null = null;
  try {
    const [personas, presetAvatars] = await Promise.all([
      getCachedAllPersonas(guildDiscId),
      loadStatsPresetAvatarLookup(),
    ]);
    const persona = personas.find((candidate) => candidate.persona_lineage_id === lineageId);
    if (persona) {
      personaName = persona.persona_nickname;
      personaAvatarDataUri = await loadStatsPersonaAvatarDataUri(persona, presetAvatars);
    }
  } catch (error) {
    log.warn("personaCardGatherer: persona resolution failed", error as Error);
  }

  let userAvatarDataUri: string | null = null;
  if (userAvatarUrl) {
    try {
      userAvatarDataUri = await loadStoredPersonaAvatarDataUri(userAvatarUrl);
    } catch (error) {
      log.warn("personaCardGatherer: user avatar resolution failed", error as Error);
    }
  }

  let favoriteEmojis: EmojiIcon[] = [];
  try {
    favoriteEmojis = await resolveEmojiIcons(guild, emojiEntries);
  } catch (error) {
    log.warn("personaCardGatherer: emoji resolution failed", error as Error);
    favoriteEmojis = emojiEntries.map((entry) => ({ name: entry.key, imageDataUri: null }));
  }

  const [palette, userPalette] = await Promise.all([
    extractCardPalette(personaAvatarDataUri ?? userAvatarDataUri ?? null),
    extractCardPalette(userAvatarDataUri),
  ]);
  const tomoriconDataUri = await loadTomoriconDataUri(palette.ink);

  return {
    locale,
    timeframe,
    username,
    userAvatarDataUri,
    personaName,
    personaAvatarDataUri,
    tomoriconDataUri,
    palette,
    userPalette,
    inputTokens: tokenTotals.inputTokens,
    outputTokens: tokenTotals.outputTokens,
    totalTriggers,
    estimatedCost,
    memoryCount,
    conditioning: { rewards: conditioning.rewards, punishments: conditioning.punishments },
    favoriteEmojis,
    favoriteEmotions: toEmotionSegments(emotionEntries),
    favoriteTools: toSegments(toolEntries),
  };
}
