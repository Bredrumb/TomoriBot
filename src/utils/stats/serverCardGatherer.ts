/**
 * Gatherer for the Server Leaderboard infographic. It owns database reads,
 * Discord display-name resolution, image-data conversion, and per-avatar accent
 * sampling; the renderer is a pure function of the resulting ServerCardData.
 *
 * Layout mirrors the Personal Wrapped "golden standard": a light-mode card whose
 * palette is derived from the server icon, a vertical bar chart of the top
 * personas by tokens, then horizontal bars for the most active members and the
 * top models, and finally the server-wide token/spend totals.
 */
import type { Guild } from "discord.js";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { statRepository } from "@/utils/db/repositories";
import type { TopUserEntry } from "@/utils/db/repositories/StatRepository";
import { log } from "@/utils/misc/logger";
import { loadStoredPersonaAvatarDataUri } from "@/utils/storage/avatarStorage";
import { type Timeframe, resolveWindowFrom } from "@/utils/stats/statsDashboard";
import { prettifyModelCodename } from "@/utils/provider/customProviderUtils";
import { extractAvatarAccentColor, extractCardPalette, loadTomoriconDataUri } from "@/utils/stats/cardColor";
import type {
  PersonIcon,
  ServerCardData,
  ServerMemberBar,
  ServerModelBar,
  ServerPersonaBar,
} from "@/utils/stats/statsInfographic";

export interface GatherServerCardArgs {
  serverId: number;
  guildDiscId: string;
  serverName: string;
  locale: string;
  timeframe: Timeframe;
  guild: Guild;
}

/** Resolves each top user's display name + avatar data URI (graceful on fetch failure). */
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

export async function gatherServerCardData(args: GatherServerCardArgs): Promise<ServerCardData> {
  const { serverId, guildDiscId, serverName, locale, timeframe, guild } = args;
  const windowFrom = resolveWindowFrom(timeframe);
  const windowArg = windowFrom ? { from: windowFrom } : {};

  // 1. One grouped query per ranked block — no per-row token/cost lookups.
  const [rawTopMembers, personaTokenCosts, modelCosts, tokenTotals, totalTriggers, estimatedCost] = await Promise.all([
    statRepository.getTopUsers({ serverId, limit: 3, ...windowArg }),
    statRepository.getPersonaTokenCostBreakdown({ serverId, limit: 5, ...windowArg }),
    statRepository.getModelCostBreakdown({ serverId, limit: 3, ...windowArg }),
    statRepository.getTokenTotals({ serverId, ...windowArg }),
    statRepository.getMetricTotal({ metric: "message_sent", serverId, ...windowArg }),
    statRepository.getEstimatedCost({ serverId, ...windowArg }),
  ]);

  // 2. Server icon → light-mode card palette (analogous to Personal's #1 avatar).
  let serverIconDataUri: string | null = null;
  const serverIconUrl = guild.iconURL({ extension: "png", forceStatic: true, size: 128 });
  if (serverIconUrl) {
    try {
      serverIconDataUri = await loadStoredPersonaAvatarDataUri(serverIconUrl);
    } catch (error) {
      log.warn("serverCardGatherer: server icon resolution failed", error as Error);
    }
  }
  const palette = await extractCardPalette(serverIconDataUri);
  const tomoriconDataUri = await loadTomoriconDataUri(palette.ink);

  // 3. Top personas (horizontal bars) — names + avatars from cache, bar tint from avatar.
  let topPersonas: ServerPersonaBar[] = [];
  try {
    const personas = await getCachedAllPersonas(guildDiscId);
    topPersonas = await Promise.all(
      personaTokenCosts.map(async (entry, index) => {
        const persona = personas.find((candidate) => candidate.persona_lineage_id === entry.lineageId);
        const avatarDataUri = persona?.webhook_avatar_url
          ? await loadStoredPersonaAvatarDataUri(persona.webhook_avatar_url)
          : null;
        const accent = await extractAvatarAccentColor(avatarDataUri, palette.accent);
        return {
          name: persona?.persona_nickname ?? `Persona #${entry.lineageId}`,
          avatarDataUri,
          rank: index + 1,
          totalTokens: entry.inputTokens + entry.outputTokens,
          estimatedCost: entry.cost,
          accent,
        };
      }),
    );
  } catch (error) {
    log.warn("serverCardGatherer: persona resolution failed", error as Error);
  }

  // 4. Most active members (horizontal bars) — avatar + per-avatar bar tint.
  const memberIcons = await resolveHumanIcons(guild, rawTopMembers);
  const topMembers: ServerMemberBar[] = await Promise.all(
    rawTopMembers.map(async (entry, index) => ({
      ...memberIcons[index],
      rank: index + 1,
      triggers: entry.count,
      accent: await extractAvatarAccentColor(memberIcons[index].avatarDataUri, palette.accentSecondary),
    })),
  );

  // 5. Top models (horizontal bars) — token-ranked, no avatar.
  const topModels: ServerModelBar[] = modelCosts.map((entry) => ({
    name: prettifyModelCodename(entry.model),
    totalTokens: entry.inputTokens + entry.outputTokens,
    estimatedCost: entry.cost,
  }));

  return {
    locale,
    timeframe,
    serverName,
    serverIconDataUri,
    tomoriconDataUri,
    palette,
    topPersonas,
    topMembers,
    topModels,
    totalTokens: tokenTotals.inputTokens + tokenTotals.outputTokens,
    estimatedCost,
    totalTriggers,
  };
}
