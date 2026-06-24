/**
 * Gatherer for the Server Leaderboard infographic. It owns database reads,
 * Discord display-name resolution, and image-data conversion; the renderer is
 * a pure function of the resulting ServerCardData.
 */
import type { Guild } from "discord.js";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { statRepository } from "@/utils/db/repositories";
import type { TopUserEntry } from "@/utils/db/repositories/StatRepository";
import { log } from "@/utils/misc/logger";
import { loadStoredPersonaAvatarDataUri } from "@/utils/storage/avatarStorage";
import { type Timeframe, resolveWindowFrom } from "@/utils/stats/statsDashboard";
import { prettifyModelCodename } from "@/utils/provider/customProviderUtils";
import type {
  EmojiIcon,
  PersonIcon,
  ServerCardData,
  ServerHumanEntry,
  ServerPersonaEntry,
} from "@/utils/stats/statsInfographic";

export interface GatherServerCardArgs {
  serverId: number;
  guildDiscId: string;
  serverName: string;
  locale: string;
  timeframe: Timeframe;
  guild: Guild;
}

async function resolveHumanIcons(guild: Guild, entries: TopUserEntry[]): Promise<PersonIcon[]> {
  return Promise.all(
    entries.map(async (entry) => {
      try {
        const member = await guild.members.fetch(entry.userDiscId);
        const avatarDataUri = await loadStoredPersonaAvatarDataUri(
          member.displayAvatarURL({ extension: "png", forceStatic: true, size: 128 }),
        );
        return { name: member.displayName, avatarDataUri };
      } catch {
        return { name: `@${entry.userDiscId.slice(-4)}`, avatarDataUri: null };
      }
    }),
  );
}

async function resolveEmojiIcons(guild: Guild, entries: Array<{ key: string; count: number }>): Promise<EmojiIcon[]> {
  return Promise.all(
    entries.map(async (entry) => {
      const emoji = guild.emojis.cache.find((candidate) => candidate.name === entry.key);
      const imageDataUri = emoji
        ? await loadStoredPersonaAvatarDataUri(emoji.imageURL({ extension: "png", size: 64 }))
        : null;
      return { name: entry.key, imageDataUri };
    }),
  );
}

export async function gatherServerCardData(args: GatherServerCardArgs): Promise<ServerCardData> {
  const { serverId, guildDiscId, serverName, locale, timeframe, guild } = args;
  const windowFrom = resolveWindowFrom(timeframe);
  const windowArg = windowFrom ? { from: windowFrom } : {};

  const [rawTopHumans, personaRoster, tokenTotals, totalTriggers, estimatedCost, modelBreakdown, emojiEntries] =
    await Promise.all([
      statRepository.getTopUsers({ serverId, limit: 3, ...windowArg }),
      statRepository.getServerPersonaMessages({ serverId, limit: 3, ...windowArg }),
      statRepository.getTokenTotals({ serverId, ...windowArg }),
      statRepository.getMetricTotal({ metric: "message_sent", serverId, ...windowArg }),
      statRepository.getEstimatedCost({ serverId, ...windowArg }),
      statRepository.getModelBreakdown({ serverId, ...windowArg }),
      statRepository.getMetricKeyBreakdown({ metric: "emoji_used", serverId, limit: 5, ...windowArg }),
    ]);

  const [humanIcons, humanCosts] = await Promise.all([
    resolveHumanIcons(guild, rawTopHumans),
    Promise.all(
      rawTopHumans.map((entry) => statRepository.getEstimatedCost({ serverId, userId: entry.userId, ...windowArg })),
    ),
  ]);
  const topHumans: ServerHumanEntry[] = rawTopHumans.map((entry, index) => ({
    ...humanIcons[index],
    rank: index + 1,
    triggers: entry.count,
    estimatedCost: humanCosts[index] ?? 0,
  }));

  let topPersonas: ServerPersonaEntry[] = [];
  try {
    const personas = await getCachedAllPersonas(guildDiscId);
    topPersonas = await Promise.all(
      personaRoster.map(async (entry, index) => {
        const persona = personas.find((candidate) => candidate.persona_lineage_id === entry.lineageId);
        const [personaTokens, avatarDataUri] = await Promise.all([
          statRepository.getTokenTotals({ serverId, lineageId: entry.lineageId, ...windowArg }),
          persona?.webhook_avatar_url
            ? loadStoredPersonaAvatarDataUri(persona.webhook_avatar_url)
            : Promise.resolve(null),
        ]);
        return {
          name: persona?.persona_nickname ?? `Persona #${entry.lineageId}`,
          avatarDataUri,
          rank: index + 1,
          inputTokens: personaTokens.inputTokens,
          outputTokens: personaTokens.outputTokens,
          sharePct: totalTriggers > 0 ? (entry.count / totalTriggers) * 100 : 0,
        };
      }),
    );
  } catch (error) {
    log.warn("serverCardGatherer: persona resolution failed", error as Error);
  }

  let serverIconDataUri: string | null = null;
  const serverIconUrl = guild.iconURL({ extension: "png", forceStatic: true, size: 128 });
  if (serverIconUrl) {
    try {
      serverIconDataUri = await loadStoredPersonaAvatarDataUri(serverIconUrl);
    } catch (error) {
      log.warn("serverCardGatherer: server icon resolution failed", error as Error);
    }
  }

  let topPersonaEmojis: EmojiIcon[] = [];
  try {
    topPersonaEmojis = await resolveEmojiIcons(guild, emojiEntries);
  } catch (error) {
    log.warn("serverCardGatherer: emoji resolution failed", error as Error);
    topPersonaEmojis = emojiEntries.map((entry) => ({ name: entry.key, imageDataUri: null }));
  }

  return {
    locale,
    timeframe,
    serverName,
    serverIconDataUri,
    topPersonas,
    topHumans,
    topModelName: modelBreakdown[0] ? prettifyModelCodename(modelBreakdown[0].model) : null,
    inputTokens: tokenTotals.inputTokens,
    outputTokens: tokenTotals.outputTokens,
    estimatedCost,
    totalTriggers,
    topPersonaEmojis,
  };
}
